/**
 * AWF Adaptive Language — Auto-detect language and adapt communication
 * Converts Antigravity awf-adaptive-language to LV-ZERO native
 * 
 * Actions: detect (detect language from text), adapt (get adaptation rules)
 */

// ─── Language Detection ───────────────────────────────────────
const SPANISH_MARKERS = [
  'que', 'por', 'para', 'como', 'pero', 'porque', 'cuando', 'donde',
  'más', 'menos', 'muy', 'poco', 'todo', 'nada', 'bien', 'mal',
  'hola', 'gracias', 'bueno', 'mejor', 'peor', 'quiero', 'necesito',
  'puedo', 'puedes', 'tengo', 'tienes', 'vamos', 'hacer', 'dime',
  'mira', 'sabes', 'creo', 'crees', 'pienso', 'piensas', 'parece',
  'ó', 'á', 'é', 'í', 'ú', 'ñ', '¿', '¡'
];

const ENGLISH_MARKERS = [
  'the', 'this', 'that', 'with', 'from', 'have', 'been', 'would',
  'could', 'should', 'about', 'which', 'their', 'there', 'think',
  'what', 'when', 'where', 'how', 'why', 'please', 'thanks'
];

function detectLanguage(text) {
  if (!text) return { language: 'unknown', confidence: 0 };
  
  const lower = text.toLowerCase();
  let spanishScore = 0;
  let englishScore = 0;
  
  // Count Spanish markers (accented chars are strong signals)
  const spanishAccents = (lower.match(/[áéíóúñ¿¡]/g) || []).length;
  spanishScore += spanishAccents * 3;
  
  for (const word of SPANISH_MARKERS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    spanishScore += (lower.match(regex) || []).length;
  }
  
  for (const word of ENGLISH_MARKERS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    englishScore += (lower.match(regex) || []).length;
  }
  
  // Code-only input → neutral
  const codeChars = (lower.match(/[{}[\]();=><+\-*/%&|^!~`@#$]/g) || []).length;
  const totalChars = lower.replace(/\s/g, '').length;
  if (totalChars > 0 && codeChars / totalChars > 0.3) {
    return { language: 'code', confidence: Math.round((codeChars / totalChars) * 100) };
  }
  
  const total = spanishScore + englishScore;
  if (total === 0) return { language: 'unknown', confidence: 0 };
  
  if (spanishScore > englishScore) {
    return { language: 'es', confidence: Math.round((spanishScore / total) * 100) };
  }
  return { language: 'en', confidence: Math.round((englishScore / total) * 100) };
}

// ─── Technical Level Adaptation ───────────────────────────────
const TERMS = {
  newbie: {
    database: 'base de datos (donde se guarda la información)',
    API: 'puente de comunicación entre sistemas',
    deploy: 'publicar en internet',
    commit: 'guardar cambios',
    branch: 'versión alterna del proyecto',
    server: 'computadora que mantiene todo funcionando',
    frontend: 'lo que ves en pantalla',
    backend: 'lo que procesa datos sin verse',
    error: 'algo que salió mal',
    debug: 'investigar y arreglar el problema',
  },
  basic: {
    database: 'base de datos',
    API: 'API / endpoint',
    deploy: 'deploy / publicación',
    commit: 'commit (guardar en git)',
    branch: 'rama del proyecto',
    server: 'servidor',
    frontend: 'frontend (UI)',
    backend: 'backend (lógica)',
    error: 'error',
    debug: 'debuggear',
  },
  advanced: {
    // Technical terms used as-is
  }
};

function getAdaptation(level, text) {
  if (level === 'advanced' || !TERMS[level]) return { adapted: false, text };
  
  const dict = TERMS[level];
  let adapted = text;
  let changes = 0;
  
  for (const [term, replacement] of Object.entries(dict)) {
    const regex = new RegExp(`\\b${term}\\b`, 'gi');
    const matches = adapted.match(regex);
    if (matches) {
      adapted = adapted.replace(regex, replacement);
      changes += matches.length;
    }
  }
  
  return { adapted: changes > 0, text: adapted, changes };
}

// ─── Main Handler ─────────────────────────────────────────────
export default {
  name: 'awf_adaptive_language',
  description: 'Auto-detecta idioma (español/inglés/código) y adapta comunicación según nivel técnico del usuario. Actions: detect, adapt, levels.',
  
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['detect', 'adapt', 'levels'],
        description: 'detect (detectar idioma), adapt (adaptar texto a nivel), levels (mostrar niveles)'
      },
      text: {
        type: 'string',
        description: 'Texto a analizar o adaptar'
      },
      level: {
        type: 'string',
        enum: ['newbie', 'basic', 'advanced'],
        description: 'Nivel técnico para adaptación (default: basic)'
      }
    },
    required: ['action']
  },

  async handler({ action, text, level }) {
    switch (action) {
      case 'detect': {
        if (!text) return { error: 'Se requiere el parámetro "text"' };
        const result = detectLanguage(text);
        return {
          ...result,
          recommendation: result.language === 'es' ? 'Responder en español' :
                          result.language === 'en' ? 'Respond in English' :
                          result.language === 'code' ? 'Technical/code context — respond in user\'s last language' :
                          'Language unclear — default to Spanish with Luis'
        };
      }
      
      case 'adapt': {
        if (!text) return { error: 'Se requiere el parámetro "text"' };
        const lvl = level || 'basic';
        const result = getAdaptation(lvl, text);
        return { level: lvl, ...result };
      }
      
      case 'levels': {
        return {
          levels: {
            newbie: 'No sabe programar. Explicar TODO con analogías simples. Cero jerga técnica.',
            basic: 'Sabe lo básico. Usar términos técnicos con explicación breve entre paréntesis.',
            advanced: 'Técnico/desarrollador. Usar lenguaje técnico normal sin explicaciones.'
          },
          terms: TERMS
        };
      }
      
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
};
