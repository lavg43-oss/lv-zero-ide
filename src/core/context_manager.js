/**
 * lv-zero — ContextManager (Gestión de Memoria)
 *
 * v2.0
 *   AHORA CON AUTO-MEMORIA PERSISTENTE EN SUPABASE.
 *   Monitorea el tamaño del historial de conversación.
 *   Si excede los límites, resume automáticamente los logs técnicos
 *   de herramientas previas, manteniendo solo:
 *     - Instrucción original (system prompt)
 *     - Estado actual
 *     - Último resultado relevante
 *   Y ADEMÁS: guarda el resumen en Supabase via auto_memoria skill.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Configuration ──────────────────────────────────────────────────────────
const CONFIG = {
  // Máximo de mensajes antes de forzar resumen
  MAX_MESSAGES: 500,
  // Máximo de caracteres totales antes de forzar resumen
  MAX_CHARS: 4000000,   // ~1M tokens — DeepSeek V4 context window — well within 1M context window
  // Máximo de tool_calls consecutivas antes de compactar
  MAX_TOOL_CALLS: 100,
  // Percentil de mensajes a conservar en modo resumen
  KEEP_RATIO: 0.3,
  // Umbrales para auto-memoria en Supabase (más temprano que la compactación local)
  SUPABASE_MESSAGE_WATERMARK: 6,    // <-- reducido de 15: el agente acumula mensajes internos rápido
  SUPABASE_CHAR_WATERMARK: 6000,    // <-- reducido de 10000
  SUPABASE_TOOL_CALL_WATERMARK: 2,  // <-- reducido de 4: detecta actividad de herramientas más temprano
  // ── Garbage Collector: conversación normal (sin tool calls intensivas) ──
  MAX_CONVERSATION_TOKENS: 4000,    // ~4K tokens — threshold for light conversation GC
  MAX_CONVERSATION_CHARS: 16000,    // ~16K chars — approximate char equivalent
};

// ─── Internal State ─────────────────────────────────────────────────────────
let historyStats = {
  totalMessages: 0,
  totalChars: 0,
  toolCallCount: 0,
  lastSummary: null,
  summaryCount: 0,
  // Auto-memoria tracking
  checkpointCount: 0,
  lastCheckpointTime: null,
  pendingCheckpoints: [],
};

// ─── Auto-Memoria Bridge (carga lazy de la skill auto_memoria) ─────────────
let autoMemoriaModule = null;

async function getAutoMemoria() {
  if (autoMemoriaModule) return autoMemoriaModule;
  try {
    const skillsDir = path.resolve(__dirname, '..', '..', 'skills');
    const amPath = path.resolve(skillsDir, 'auto_memoria.js');
    if (fs.existsSync(amPath)) {
      const bustedPath = `${amPath}?t=${Date.now()}`;
      autoMemoriaModule = await import(`file://${bustedPath.replace(/\\/g, '/')}`);
      return autoMemoriaModule;
    }
  } catch (err) {
    console.warn(`   ⚠️ auto_memoria no disponible: ${err.message}`);
  }
  return null;
}

/**
 * Verifica si es necesario guardar un checkpoint en Supabase
 * y lo ejecuta si es necesario.
 */
async function checkAndSaveCheckpoint(messages) {
  try {
    const am = await getAutoMemoria();
    if (!am || !am.guardarCheckpoint) return null;

    const stats = await actualizarEstadísticas(messages);
    
    const shouldSave = 
      stats.totalMessages >= CONFIG.SUPABASE_MESSAGE_WATERMARK ||
      stats.totalChars >= CONFIG.SUPABASE_CHAR_WATERMARK ||
      stats.toolCallCount >= CONFIG.SUPABASE_TOOL_CALL_WATERMARK;

    if (!shouldSave) return null;

    // Generar resumen de los últimos mensajes para el checkpoint
    const systemMessages = messages.filter(m => m.role === 'system');
    const lastMessages = messages.slice(-10);
    
    let totalContent = '';
    for (const msg of lastMessages) {
      if (msg.content && typeof msg.content === 'string') {
        totalContent += msg.content.substring(0, 300) + '\n';
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          totalContent += `[${tc.function?.name || 'tool'}]\n`;
        }
      }
    }

    const summary = totalContent.substring(0, 2000);
    
    const result = await am.guardarCheckpoint({
      topic: `checkpoint:contexto`,
      content: `[Checkpoint automático - Sesión activa]\nMensajes totales: ${stats.totalMessages}\nTool calls: ${stats.toolCallCount}\nCaracteres: ~${stats.totalChars}\n\nÚltimo contexto:\n${summary}`,
      source: 'context_manager',
    });

    if (result && result.success) {
      historyStats.checkpointCount++;
      historyStats.lastCheckpointTime = new Date().toISOString();
    }

    return result;
  } catch (err) {
    console.warn(`   ⚠️ Error en checkpoint Supabase: ${err.message}`);
    return null;
  }
}

/**
 * Analiza el array de mensajes y devuelve estadísticas de tamaño.
 * @param {Array} messages - Conversation history array
 * @returns {{ totalMessages: number, totalChars: number, toolCallCount: number }}
 */
export function analyzeHistory(messages) {
  if (!Array.isArray(messages)) {
    return { totalMessages: 0, totalChars: 0, toolCallCount: 0 };
  }

  let totalChars = 0;
  let toolCallCount = 0;

  for (const msg of messages) {
    if (msg.content && typeof msg.content === "string") {
      totalChars += msg.content.length;
    }
    // Count messages with tool_calls
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      toolCallCount += msg.tool_calls.length;
    }
    // Count tool result messages
    if (msg.role === "tool") {
      toolCallCount++;
    }
  }

  const stats = {
    totalMessages: messages.length,
    totalChars,
    toolCallCount,
    lastSummary: historyStats.lastSummary,
    summaryCount: historyStats.summaryCount,
    checkpointCount: historyStats.checkpointCount,
    lastCheckpointTime: historyStats.lastCheckpointTime,
  };

  historyStats = { ...historyStats, ...stats };
  return stats;
}

/**
 * Función interna para actualizar y devolver estadísticas.
 */
async function actualizarEstadísticas(messages) {
  return analyzeHistory(messages);
}

/**
 * Determina si la conversación necesita ser resumida basado en las estadísticas.
 * @param {Array} messages - Conversation history array
 * @returns {{ needsSummary: boolean, reason: string | null }}
 */
export function needsSummary(messages) {
  const stats = analyzeHistory(messages);

  if (stats.totalMessages >= CONFIG.MAX_MESSAGES) {
    return {
      needsSummary: true,
      reason: `Demasiados mensajes (${stats.totalMessages}/${CONFIG.MAX_MESSAGES})`,
    };
  }

  if (stats.totalChars >= CONFIG.MAX_CHARS) {
    return {
      needsSummary: true,
      reason: `Saturación de tokens (~${stats.totalChars}/${CONFIG.MAX_CHARS} chars)`,
    };
  }

  if (stats.toolCallCount >= CONFIG.MAX_TOOL_CALLS) {
    return {
      needsSummary: true,
      reason: `Muchas tool_calls consecutivas (${stats.toolCallCount}/${CONFIG.MAX_TOOL_CALLS})`,
    };
  }

  return { needsSummary: false, reason: null };
}

/**
 * Versión async que chequea checkpoint en Supabase además de la compactación local.
 * @param {Array} messages - Conversation history array
 * @returns {Promise<{ needsSummary: boolean, reason: string | null, checkpointSaved: boolean }>}
 */
export async function needsSummaryWithCheckpoint(messages) {
  const check = needsSummary(messages);
  
  // Siempre verificar si debemos guardar en Supabase (umbrales más tempranos)
  let checkpointSaved = false;
  const cp = await checkAndSaveCheckpoint(messages);
  if (cp && cp.success) checkpointSaved = true;

  return {
    needsSummary: check.needsSummary,
    reason: check.reason,
    checkpointSaved,
  };
}

/**
 * Resumes the conversation history to prevent token saturation.
 * Keeps: system prompt, last user message, last assistant response, recent context.
 * Compacts: tool call logs into a single summary message.
 *
 * @param {Array} messages - Full conversation history
 * @returns {Array} - Compacted/conversation history
 */
export function compactHistory(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const stats = analyzeHistory(messages);
  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystemMessages = messages.filter((m) => m.role !== "system");

  if (nonSystemMessages.length === 0) return messages;

  // Always keep the system prompt(s)
  const kept = [...systemMessages];

  // Keep the last N messages based on KEEP_RATIO
  const keepCount = Math.max(
    5, // minimum
    Math.ceil(nonSystemMessages.length * CONFIG.KEEP_RATIO)
  );

  // Get slices: first 2 (user + assistant) + recent context
  const headCount = Math.min(2, nonSystemMessages.length);
  const head = nonSystemMessages.slice(0, headCount);
  const tail = nonSystemMessages.slice(-keepCount);

  // Build deduplicated set preserving order
  const seenIndices = new Set();
  const importantMessages = [];

  // Add head first
  for (const msg of head) {
    const idx = nonSystemMessages.indexOf(msg);
    if (!seenIndices.has(idx) && idx !== -1) {
      seenIndices.add(idx);
      importantMessages.push(msg);
    }
  }

  // Add tail (avoid duplicates)
  for (const msg of tail) {
    const idx = nonSystemMessages.indexOf(msg);
    if (!seenIndices.has(idx) && idx !== -1) {
      seenIndices.add(idx);
      importantMessages.push(msg);
    }
  }

  // ── CRITICAL FIX: Ensure tool_call chains remain intact ────────────────
  // If an assistant message with tool_calls is kept, ALL corresponding
  // tool responses MUST also be kept. Orphaned tool_call_ids cause
  // DeepSeek API 400 errors.
  const toolCallIdsNeeded = new Set();
  for (const msg of importantMessages) {
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        toolCallIdsNeeded.add(tc.id);
      }
    }
  }

  // Scan for any tool responses that provide these IDs
  for (let i = 0; i < nonSystemMessages.length; i++) {
    if (!seenIndices.has(i)) {
      const msg = nonSystemMessages[i];
      if (msg.role === "tool" && toolCallIdsNeeded.has(msg.tool_call_id)) {
        // This tool response is needed but wasn't in head/tail — force keep it
        seenIndices.add(i);
        importantMessages.push(msg);
        toolCallIdsNeeded.delete(msg.tool_call_id);
      }
    }
  }

  // If any tool_call_ids are still orphaned (no response available),
  // strip the tool_calls from the assistant message to prevent API errors
  if (toolCallIdsNeeded.size > 0) {
    for (const msg of importantMessages) {
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        msg.tool_calls = msg.tool_calls.filter(
          (tc) => !toolCallIdsNeeded.has(tc.id)
        );
        if (msg.tool_calls.length === 0) {
          delete msg.tool_calls;
        }
      }
    }
  }

  // Collect tool logs that were excluded for summarization
  const compactedTools = [];
  for (let i = 0; i < nonSystemMessages.length; i++) {
    if (!seenIndices.has(i)) {
      const msg = nonSystemMessages[i];
      if (msg.role === "tool" || msg.role === "assistant") {
        // Add a compressed entry
        const toolInfo = msg.tool_calls
          ? msg.tool_calls
              .map((tc) => {
                const name = tc.function?.name || "unknown";
                const args = tc.function?.arguments || "{}";
                return `[${name}(${args.substring(0, 100)})]`;
              })
              .join(", ")
          : msg.content
          ? msg.content.substring(0, 150)
          : null;

        if (toolInfo) {
          compactedTools.push(toolInfo);
        }
      }
    }
  }

  // Add compacted tool summary if there were excluded messages
  if (compactedTools.length > 0) {
    const summaryContent = `[RESUMEN AUTOMÁTICO - ${compactedTools.length} tool_calls compactadas]: ${compactedTools.join(" → ")}`;
    kept.push({
      role: "system",
      content: summaryContent,
    });
  }

  // Add important messages (head + tail) in original order
  // Sort by original index to preserve chronological order
  importantMessages.sort((a, b) => {
    const idxA = nonSystemMessages.indexOf(a);
    const idxB = nonSystemMessages.indexOf(b);
    return idxA - idxB;
  });

  for (const msg of importantMessages) {
    kept.push(msg);
  }

  // Update summary tracking
  historyStats.lastSummary = new Date().toISOString();
  historyStats.summaryCount++;

  // Log compaction but don't modify the message array
  if (messages.length > kept.length) {
    console.log(`[context] Compactado: ${messages.length - kept.length} mensajes removidos (${kept.length} preservados)`);
  }

  // ── Safety fallback: if no messages were removed and we're still over limit ──
  if (messages.length === kept.length && messages.length > CONFIG.MAX_MESSAGES) {
    // Keep system messages + last (MAX_MESSAGES - systemCount) non-system messages
    const systemMsgs = messages.filter(m => m.role === "system");
    const nonSystemMsgs = messages.filter(m => m.role !== "system");
    const keepCount = Math.max(1, CONFIG.MAX_MESSAGES - systemMsgs.length);
    const forceKept = [...systemMsgs, ...nonSystemMsgs.slice(-keepCount)];
    console.warn(`   ⚠️  Fuerza de truncamiento: ${messages.length} → ${forceKept.length} mensajes`);
    return forceKept;
  }

  return kept;
}

/**
 * Decorador opcional: envuelve una función de chat para auto-gestión de memoria.
 * Útil para integrar directamente en el agent loop.
 *
 * @param {Function} chatFn - Async function that sends messages to the API
 * @returns {Function} - Wrapped function with automatic memory management
 */
export function withMemoryManagement(chatFn) {
  return async function (messages, ...args) {
    // Verificar checkpoint en Supabase (async)
    try {
      await checkAndSaveCheckpoint(messages);
    } catch (_) {}

    const check = needsSummary(messages);

    if (check.needsSummary) {
      const before = messages.length;
      messages = compactHistory(messages);
      const after = messages.length;

      console.log(
        `   🧠 Compactación de memoria: ${before} → ${after} mensajes (${check.reason})`
      );
    }

    return chatFn(messages, ...args);
  };
}

/**
 * Carga la memoria de sesiones anteriores desde Supabase.
 * @returns {Promise<string|null>} - Texto de contexto restaurado o null
 */
export async function loadPreviousContext() {
  try {
    const am = await getAutoMemoria();
    if (!am || !am.cargarContextoInicial) return null;

    const result = await am.cargarContextoInicial({ limit: 10 });
    if (!result.success || !result.data || result.data.length === 0) return null;

    let contextText = '--- MEMORIA DE SESIONES ANTERIORES ---\n';
    for (const rec of result.data) {
      const contentPreview = rec.content.substring(0, 300);
      contextText += `[${rec.topic}] (${new Date(rec.created_at).toLocaleDateString()}): ${contentPreview}\n\n`;
    }
    contextText += '--- FIN MEMORIA ---';

    return contextText;
  } catch (err) {
    console.warn(`   ⚠️ Error cargando contexto previo: ${err.message}`);
    return null;
  }
}

// ─── Garbage Collector (4K Token Threshold) ──────────────────────────────

/**
 * Attempts to summarize old messages using Gemini Flash (free).
 * Requires gemini-flash provider to be initialized in the orchestrator's LLMClient.
 *
 * This is a lightweight version of the emergency distillation — it only
 * summarizes the oldest conversation messages to keep the context small.
 *
 * @param {Array<object>} oldMessages - Messages to summarize
 * @param {object} [llmClient] - LLMClient instance (for provider access)
 * @returns {Promise<string|null>} Summary text or null if summarization fails
 */
export async function summarizeForGC(oldMessages, llmClient = null) {
  if (!oldMessages || oldMessages.length === 0) return null;

  let summary = null;

  // Try Gemini Flash first (if available via llmClient)
  if (llmClient) {
    try {
      const geminiProvider = llmClient.getRawProvider?.("gemini-flash") ??
                             llmClient._providers?.["gemini-flash"];

      if (geminiProvider && geminiProvider.isReady()) {
        const conversationText = oldMessages
          .filter(m => m.role !== "system")
          .map(m => `${m.role}: ${String(m.content || "").substring(0, 300)}`)
          .join("\n")
          .substring(0, 8000); // Limit input to Gemini

        const prompt = [
          { role: "system", content: "Resume esta conversación en 1-2 frases en español. Captura SOLO el tema principal y las decisiones tomadas. Sé extremadamente conciso. Máximo 2 frases." },
          { role: "user", content: conversationText },
        ];

        const response = await geminiProvider.complete(prompt, {
          max_tokens: 150,
          temperature: 0.2,
        });

        summary = response?.choices?.[0]?.message?.content || null;
        if (summary) {
          console.log(`[context] 🧹 GC: ${oldMessages.length} mensajes resumidos vía Gemini (${summary.length} chars)`);
        }
      }
    } catch (_) {
      // Gemini failed — use local fallback below
    }
  }

  // Local fallback: simple extraction of key info
  if (!summary) {
    const userMsgs = oldMessages.filter(m => m.role === "user");
    const firstUserMsg = userMsgs[0]?.content?.substring(0, 200) || "";
    const topics = new Set();
    for (const m of oldMessages) {
      const content = String(m.content || "");
      if (content.includes("Error") || content.includes("error")) {
        topics.add("errores encontrados");
      }
      if (content.includes("instalar") || content.includes("install") || content.includes("npm")) {
        topics.add("instalación/configuración");
      }
    }

    summary = `Conversación sobre: "${firstUserMsg}". ` +
      (topics.size > 0 ? `Temas: ${Array.from(topics).join(", ")}. ` : "") +
      `${oldMessages.length} mensajes compactados.`;

    console.log(`[context] 🧹 GC: ${oldMessages.length} mensajes resumidos localmente (${summary.length} chars)`);
  }

  return summary;
}

/**
 * Garbage collect the conversation history to stay under 4K tokens.
 *
 * Keeps:
 *   - System prompt (first message)
 *   - Summary of old messages (generated by Gemini or local fallback)
 *   - Last 10 messages (most recent context)
 *
 * This is separate from compactHistory() which is designed for tool-call
 * intensive loops with much higher thresholds.
 *
 * @param {Array<object>} messages - Full message array
 * @param {object} [llmClient]     - Optional LLMClient for Gemini summarization
 * @returns {Promise<Array<object>>} Compacted message array
 */
export async function garbageCollectHistory(messages, llmClient = null) {
  if (!Array.isArray(messages) || messages.length <= 15) return messages;

  const stats = analyzeHistory(messages);

  // Only apply GC for "light" conversations — tool-call intensive loops
  // use the compactHistory() path with much higher thresholds.
  const isLightConversation = stats.toolCallCount < 10 && stats.totalChars > CONFIG.MAX_CONVERSATION_CHARS;

  if (!isLightConversation) return messages;

  const systemMsg = messages.find(m => m.role === "system");
  const oldMessages = messages.slice(0, -10); // Everything except last 10
  const recentMessages = messages.slice(-10); // Last 10 messages

  // Try to summarize old messages
  const summary = await summarizeForGC(oldMessages, llmClient);

  const result = [];

  // Keep system prompt
  if (systemMsg) result.push(systemMsg);

  // Add summary
  if (summary) {
    result.push({
      role: "system",
      content: `[RESUMEN DE CONVERSACIÓN ANTERIOR — GC 4K tokens]: ${summary}`,
    });
  } else {
    result.push({
      role: "system",
      content: `[${oldMessages.length} mensajes anteriores omitidos por límite de tokens]`,
    });
  }

  // Add recent messages
  for (const msg of recentMessages) {
    result.push(msg);
  }

  console.log(`[context] 🧹 Garbage Collector: ${messages.length} → ${result.length} mensajes (${stats.totalChars} → ~${analyzeHistory(result).totalChars} chars)`);

  return result;
}

// ─── Reset for testing ──────────────────────────────────────────────────────
export function resetStats() {
  historyStats = {
    totalMessages: 0,
    totalChars: 0,
    toolCallCount: 0,
    lastSummary: null,
    summaryCount: 0,
    checkpointCount: 0,
    lastCheckpointTime: null,
    pendingCheckpoints: [],
  };
}

export default {
  analyzeHistory,
  needsSummary,
  needsSummaryWithCheckpoint,
  compactHistory,
  withMemoryManagement,
  loadPreviousContext,
  checkAndSaveCheckpoint,
  summarizeForGC,
  garbageCollectHistory,
  resetStats,
};
