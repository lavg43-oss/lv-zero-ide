/**
 * auto_memoria — lv-zero Auto-Memoria Persistente
 *
 * v2.1
 *   Checkpoint automático de contexto en Supabase (tabla lvzero_memory).
 *   El Orchestrator llama a guardarCheckpoint() y cargarContextoInicial()
 *   directamente cuando detecta saturación o al iniciar sesión.
 *
 *   Embeddings: usa deepseek-chat para generación real, con fallback
 *               determinístico basado en hash.
 *
 *   Carga dinámica: usa require() desde ESM por compatibilidad.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

// ─── Configuración ──────────────────────────────────────────────────────
const CONFIG = {
  // Umbrales para trigger de guardado (reducidos para checkpoints más frecuentes)
  MESSAGE_HIGH_WATERMARK: 20,        // 20 mensajes → checkpoint
  TOOL_CALL_WATERMARK: 6,            // 6 tool_calls → checkpoint
  CHAR_WATERMARK: 12000,             // 12K chars → checkpoint
  // Intervalo de checkpoint periódico (ms)
  CHECKPOINT_INTERVAL: 30000,        // 30 segundos
  // Tópicos del sistema
  SYSTEM_TOPIC_PREFIX: 'sys:',
  // Máximo de recuerdos a cargar al inicio
  MAX_RECALL: 10,
};

// ─── Estado interno ─────────────────────────────────────────────────────
let lastCheckpoint = 0;
let messageCount = 0;
let toolCallCount = 0;
let charCount = 0;
let lastSavedHash = '';  // Evita duplicados
let supabase = null;

// ─── Inicialización ─────────────────────────────────────────────────────
function initClient() {
  if (supabase) return supabase;
  
  // Memory skills ONLY use LV_SUPABASE_* — never fall back to SUPABASE_*
  const url = process.env.LV_SUPABASE_URL;
  const key = process.env.LV_SUPABASE_SERVICE_ROLE_KEY || process.env.LV_SUPABASE_KEY;
  
  if (!url || !key) {
    console.warn('⚠️ auto_memoria: LV_SUPABASE_URL/LV_SUPABASE_KEY no configuradas');
    return null;
  }
  
  supabase = createClient(url, key);
  return supabase;
}

/**
 * Genera embedding usando DeepSeek API
 */
async function generateEmbedding(text) {
  // Intentar generar embedding real usando DeepSeek
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (apiKey) {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: 'Eres un generador de embeddings. Responde ÚNICAMENTE con un array JSON de 768 números float entre -1 y 1 que represente el vector embedding. NO expliques, solo el array.' },
            { role: 'user', content: String(text).substring(0, 1000) }
          ],
          temperature: 0.0,
          max_tokens: 4000
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        const content = data.choices[0].message.content;
        const match = content.match(/\[[\s\S]*?\]/);
        if (match) {
          const vec = JSON.parse(match[0]);
          if (Array.isArray(vec) && vec.length === 768) return vec;
        }
      }
    }
  } catch (e) {
    // Fallback silencioso
  }
  
  // Fallback: vector determinístico basado en hash del texto
  const seed = hashText(text);
  const vec = [];
  for (let i = 0; i < 768; i++) {
    vec.push(Math.sin(seed * (i + 1)) * 0.5 + Math.cos(seed * (i + 0.3)) * 0.5);
  }
  return vec;
}

/**
 * Hash simple de texto para seed del embedding fallback
 */
function hashText(text) {
  let hash = 0;
  const str = String(text);
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash) / 2147483647;
}

// ─── API Pública ────────────────────────────────────────────────────────

/**
 * Al iniciar sesión: carga los últimos N recuerdos de Supabase
 * para restaurar el contexto de sesiones anteriores.
 */
async function cargarContextoInicial({ limit } = {}) {
  const client = initClient();
  if (!client) {
    return { success: false, data: [], message: '❌ Sin conexión a Supabase' };
  }

  try {
    const { data, error } = await client
      .from('lvzero_memory')
      .select('id, topic, content, created_at')
      .order('created_at', { ascending: false })
      .limit(limit || CONFIG.MAX_RECALL);

    if (error) throw error;

    if (data && data.length > 0) {
      return {
        success: true,
        data,
        message: `🧠 Memoria restaurada: ${data.length} recuerdo(s) de sesiones anteriores`
      };
    }

    return { success: true, data: [], message: '🧠 Sin memoria previa. Empezando fresco.' };
  } catch (err) {
    return { success: false, data: [], message: `⚠️ Error cargando memoria: ${err.message}` };
  }
}

/**
 * Verifica si es momento de hacer un checkpoint basado en los umbrales.
 */
function needsCheckpoint(stats) {
  if (!stats) return { shouldSave: false, reason: null };
  
  const now = Date.now();
  
  // Evitar checkpoints muy seguidos (mínimo 10s entre ellos)
  if (now - lastCheckpoint < 10000) {
    return { shouldSave: false, reason: 'demasiado pronto' };
  }
  
  if (stats.messageCount >= CONFIG.MESSAGE_HIGH_WATERMARK) {
    return { shouldSave: true, reason: `${stats.messageCount} mensajes acumulados` };
  }
  
  if (stats.toolCallCount >= CONFIG.TOOL_CALL_WATERMARK) {
    return { shouldSave: true, reason: `${stats.toolCallCount} tool_calls ejecutadas` };
  }
  
  if (stats.charCount >= CONFIG.CHAR_WATERMARK) {
    return { shouldSave: true, reason: `~${stats.charCount} caracteres de contexto` };
  }
  
  // Checkpoint periódico (2 min desde el último)
  if (now - lastCheckpoint >= CONFIG.CHECKPOINT_INTERVAL && lastCheckpoint > 0) {
    return { shouldSave: true, reason: 'checkpoint periódico (2min)' };
  }
  
  return { shouldSave: false, reason: null };
}

/**
 * Guarda un checkpoint de memoria en Supabase.
 */
async function guardarCheckpoint({ topic, content, source }) {
  const client = initClient();
  if (!client) {
    return { success: false, error: 'Sin conexión a Supabase' };
  }

  if (!topic || !content) {
    return { success: false, error: 'topic y content requeridos' };
  }

  // Evitar guardar contenido duplicado (mismo hash)
  const contentHash = hashText(content).toString(36);
  if (contentHash === lastSavedHash) {
    return { success: true, data: null, note: 'contenido duplicado, omitido' };
  }

  try {
    // 1. Generar embedding
    const embedding = await generateEmbedding(content);
    
    // 2. Limitar tamaño del contenido (max 3000 chars para no saturar la BD)
    const trimmedContent = String(content).substring(0, 3000);

    // 3. Guardar en Supabase
    const record = {
      topic: `${CONFIG.SYSTEM_TOPIC_PREFIX}${topic}`,
      content: trimmedContent,
      embedding,
    };

    const { data, error } = await client
      .from('lvzero_memory')
      .insert(record)
      .select('id, topic, created_at');

    if (error) throw error;

    // 4. Actualizar estado
    lastCheckpoint = Date.now();
    lastSavedHash = contentHash;
    messageCount = 0;
    toolCallCount = 0;
    charCount = 0;

    console.log(`   [CP] Checkpoint guardado: "${topic}" (${source || 'automático'})`);
    
    return {
      success: true,
      data: data[0],
      message: `[CP] Checkpoint guardado en lvzero_memory`
    };
  } catch (err) {
    console.error(`   ⚠️ Error en checkpoint: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Busca recuerdos por similitud semántica (embedding) o keyword.
 * @param {Object} opts
 * @param {string} opts.query - Texto de búsqueda
 * @param {number} opts.limit - Número máximo de resultados (default: 5)
 * @param {boolean} opts.useEmbedding - Si true, usa búsqueda vectorial vía RPC (default: false)
 * @param {number} opts.threshold - Umbral de similitud para búsqueda vectorial (default: 0.3)
 * @returns {Promise<Array>} Array de registros { id, topic, content, created_at }
 */
async function buscarRecuerdos({ query, limit = 5, useEmbedding = false, threshold = 0.3 }) {
  const client = initClient();
  if (!client) return [];

  try {
    // ── Modo 1: Búsqueda vectorial (embedding) via RPC ──────────────
    if (useEmbedding) {
      const queryEmbedding = await generateEmbedding(query);
      if (Array.isArray(queryEmbedding) && queryEmbedding.length === 768) {
        const { data, error } = await client.rpc('search_memory', {
          query_embedding: queryEmbedding,
          match_threshold: threshold,
          match_count: limit
        });
        if (!error && Array.isArray(data)) {
          return data.map(r => ({
            id: r.id,
            topic: r.topic || '',
            content: r.content || '',
            created_at: r.created_at,
            similarity: r.similarity
          }));
        }
        // Fallback silencioso si RPC falla → continúa con modo 2
      }
    }

    // ── Modo 2: Keyword filtering (default / fallback) ──────────────
    const { data, error } = await client
      .from('lvzero_memory')
      .select('id, topic, content, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const queryLower = query.toLowerCase();
    const relevant = (data || []).filter(r =>
      r.topic.toLowerCase().includes(queryLower) ||
      r.content.toLowerCase().includes(queryLower)
    );

    return relevant.length > 0 ? relevant : (data || []);
  } catch (err) {
    console.error(`⚠️ Error buscando recuerdos: ${err.message}`);
    return [];
  }
}

// ─── Reset (para testing) ───────────────────────────────────────────────
function reset() {
  lastCheckpoint = 0;
  messageCount = 0;
  toolCallCount = 0;
  charCount = 0;
  lastSavedHash = '';
}

// ─── Export ESM (handler + funciones sueltas) ───────────────────────────
export default {
  name: 'auto_memoria',
  handler: async (args) => {
    const { action } = args || {};
    
    switch (action) {
      case 'cargar_contexto':
        return await cargarContextoInicial(args);
      case 'checkpoint':
        return await guardarCheckpoint(args);
      case 'buscar':
        return await buscarRecuerdos(args);
      case 'needs_checkpoint':
        return needsCheckpoint(args);
      case 'reset':
        reset();
        return { success: true };
      default:
        return {
          success: false,
          error: `Acción desconocida: "${action}". Usa: cargar_contexto, checkpoint, buscar, needs_checkpoint, reset`
        };
    }
  },
  description: 'Memoria persistente del sistema. USA EXCLUSIVAMENTE las credenciales LV_SUPABASE_* (base de datos interna de lv-zero). NUNCA uses SUPABASE_* para memoria.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['cargar_contexto', 'checkpoint', 'buscar', 'needs_checkpoint', 'reset'],
        description: 'Acción a ejecutar'
      },
      topic: { type: 'string', description: 'Tópico del recuerdo (para checkpoint)' },
      content: { type: 'string', description: 'Contenido del recuerdo (para checkpoint)' },
      source: { type: 'string', description: 'Fuente del trigger' },
      query: { type: 'string', description: 'Texto de búsqueda' },
      limit: { type: 'number', description: 'Límite de resultados' },
    },
    required: ['action'],
  },
};

/**
 * Named exports para que context_manager.mjs y orchestrator.mjs
 * puedan importar directamente via import { guardarCheckpoint } from 'auto_memoria.js'
 */
export {
  cargarContextoInicial,
  guardarCheckpoint,
  needsCheckpoint,
  buscarRecuerdos,
  reset,
};
