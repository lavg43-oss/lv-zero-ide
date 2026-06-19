/**
 * lv-zero — Mode Registry
 *
 * v1.0
 *   Define los modos del agente con sus iconos, colores, tools permitidas,
 *   y patrones de archivo editables. Cada modo tiene su propio system prompt
 *   y restricciones de herramientas.
 *
 * Uso:
 *   import { MODES, getMode, getAllowedTools, canEditFile, listModes } from "./modes/mode_registry.js";
 *
 *   const mode = getMode("architect");      // → { slug, icon, name, ... }
 *   const tools = getAllowedTools("code");   // → "*" (all tools)
 *   const canEdit = canEditFile("ask", "src/file.js");  // → false
 *   const allModes = listModes();            // → [{ slug, icon, name, ... }]
 */

// ─── Mode Definitions ────────────────────────────────────────────────────────

const MODES = {
  orchestrator: {
    slug: "orchestrator",
    icon: "🔄",
    name: "Orchestrator",
    description: "Coordinate tasks across modes and orchestrate workflows",
    prompts: [],
    allowedTools: "*", // all tools
    allowedFilePatterns: "*", // all files
    color: "#FF6B35", // orange
    systemPromptFile: "orchestrator",
    defaultModel: "free", // Uses OpenRouter free models (NVIDIA Nemotron Nano 30B)
  },

  architect: {
    slug: "architect",
    icon: "🏗️",
    name: "Architect",
    description: "Design architecture and plan before coding",
    prompts: ["src/modes/prompts/architect.md"],
    allowedTools: [
      // Nativas del sistema
      "read_file",
      "search_files",
      "list_files",
      "write_to_file",
      "apply_diff",
      "ask_followup_question",
      "request_mode_switch",
      // Skills de presentaciones (Slidev + Quarto)
      "build_slidev_deck",
      "build_quarto_deck",
      "export_deck_to_static",
      // Skills de solo lectura (análisis, búsqueda, inspección)
      "graphify_explorer",
      "graphify_knowledge",
      "internet_search",
      "repo_mapper",
      "code_mapper",
      "file_indexer",
      "file_type_detector",
      "path_resolver",
      "sys_inspector",
      "buscar_recuerdo",
    ],
    allowedFilePatterns: ["*.md"],
    color: "#4A9EFF", // blue
    systemPromptFile: "architect",
    defaultModel: "cheap", // Starts with Flash; escalates to Pro after 2 failures
  },

  code: {
    slug: "code",
    icon: "💻",
    name: "Code",
    description: "Write, modify, or refactor code",
    prompts: ["src/modes/prompts/code.md"],
    allowedTools: "*", // all tools
    allowedFilePatterns: "*", // all files
    color: "#22C55E", // green
    systemPromptFile: "code",
    defaultModel: "cheap", // Starts with Flash; escalates to Pro after 2 failures
  },

  ask: {
    slug: "ask",
    icon: "❓",
    name: "Ask",
    description: "Explain, analyze, or answer questions",
    prompts: ["src/modes/prompts/ask.md"],
    allowedTools: [
      // Nativas del sistema
      "read_file",
      "search_files",
      "list_files",
      "ask_followup_question",
      "request_mode_switch",
      // Skills de presentaciones (Slidev + Quarto)
      "build_slidev_deck",
      "build_quarto_deck",
      "export_deck_to_static",
      // Skills de solo lectura (análisis, búsqueda, inspección)
      "graphify_explorer",
      "graphify_knowledge",
      "internet_search",
      "repo_mapper",
      "code_mapper",
      "file_indexer",
      "file_type_detector",
      "path_resolver",
      "sys_inspector",
      "buscar_recuerdo",
    ],
    allowedFilePatterns: [], // read-only — no file can be edited
    color: "#A855F7", // purple
    systemPromptFile: "ask",
    defaultModel: "free", // Uses OpenRouter free models (NVIDIA Nemotron Nano 30B)
  },

  debug: {
    slug: "debug",
    icon: "🪲",
    name: "Debug",
    description: "Troubleshoot and fix errors systematically",
    prompts: ["src/modes/prompts/debug.md"],
    allowedTools: "*", // all tools
    allowedFilePatterns: "*", // all files
    color: "#EF4444", // red
    systemPromptFile: "debug",
    defaultModel: "cheap", // Starts with Flash; escalates to Pro after 2 failures
  },
};

// ─── Natural Language Mode Detection Keywords ────────────────────────────────
// NO slash prefix needed. Detection is purely based on natural language patterns.
// These work alongside the existing detectIntent() in workflows/loader.js.

const MODE_KEYWORDS = {
  orchestrator: [
    'coordina', 'orquestra', 'delega', 'gestiona', 'organiza', 'supervisa', 'workflow',
  ],
  architect: [
    "plan",
    "arquitectura",
    "design",
    "diseñar",
    "diagram",
    "architecture",
    "estructura",
    "componentes",
    "flujo",
    "analiza",
    "analizar",
    "requerimientos",
    "diseño",
    "componente",
    "arquitecto",
  ],
  code: [
    "implement",
    "codigo",
    "código",
    "build",
    "crear",
    "hacer",
    "write",
    "programa",
    "desarrolla",
    "construye",
    "funcion",
    "función",
    "clase",
    "modulo",
    "módulo",
    "programar",
    "implementar",
  ],
  ask: [
    "explain",
    "explica",
    "que es",
    "como funciona",
    "diferencia",
    "why",
    "por que",
    "qué significa",
    "dime",
    "cuentame",
    "cuéntame",
    "investiga",
    "investigar",
    "qué es",
    "cómo funciona",
  ],
  debug: [
    "error",
    "bug",
    "falla",
    "debug",
    "fix",
    "corrige",
    "corregir",
    "issue",
    "crash",
    "no funciona",
    "esta roto",
    "está roto",
    "problema",
    "exception",
    "stack trace",
    "fallo",
    "falló",
    "arroja error",
    "tira error",
  ],
};

// ─── Glob Matching (simple) ─────────────────────────────────────────────────

/**
 * Simple glob pattern matcher. Supports `*` (matches everything)
 * and `*.ext` (matches files with extension).
 *
 * @param {string} pattern - Glob pattern (e.g., "*.md", "*")
 * @param {string} filePath - File path to test
 * @returns {boolean} True if filePath matches pattern
 */
function globMatch(pattern, filePath) {
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) {
    const ext = pattern.slice(1); // e.g., ".md"
    return filePath.endsWith(ext);
  }
  return false;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Obtiene la definición completa de un modo por su slug.
 * @param {string} slug - Modo slug (architect, code, ask, debug)
 * @returns {object|null} La definición del modo o null si no existe
 */
export function getMode(slug) {
  return MODES[slug] || null;
}

/**
 * Obtiene la lista de herramientas permitidas para un modo.
 * @param {string} slug - Modo slug
 * @returns {Array<string>|"*"} Array de tool names, o "*" si todas están permitidas
 */
export function getAllowedTools(slug) {
  const mode = MODES[slug];
  if (!mode) return [];
  return mode.allowedTools;
}

/**
 * Obtiene los patrones de archivo permitidos para un modo.
 * @param {string} slug - Modo slug
 * @returns {Array<string>|"*"} Array de patrones glob, o "*" si todos los archivos son editables
 */
export function getAllowedFilePatterns(slug) {
  const mode = MODES[slug];
  if (!mode) return [];
  return mode.allowedFilePatterns;
}

/**
 * Verifica si un modo puede editar un archivo específico.
 * @param {string} slug - Modo slug
 * @param {string} filePath - Ruta del archivo a verificar
 * @returns {boolean} True si el modo puede editar el archivo
 */
export function canEditFile(slug, filePath) {
  const mode = MODES[slug];
  if (!mode) return false;

  const patterns = mode.allowedFilePatterns;
  if (patterns === "*") return true;
  if (!Array.isArray(patterns) || patterns.length === 0) return false;

  return patterns.some((pattern) => globMatch(pattern, filePath));
}

/**
 * Verifica si un modo tiene permitido usar una herramienta específica.
 * @param {string} slug - Modo slug
 * @param {string} toolName - Nombre de la herramienta
 * @returns {boolean} True si la herramienta está permitida
 */
export function isToolAllowed(slug, toolName) {
  const mode = MODES[slug];
  if (!mode) return false;

  const tools = mode.allowedTools;
  if (tools === "*") return true;
  return Array.isArray(tools) && tools.includes(toolName);
}

/**
 * Lista todos los modos disponibles.
 * @returns {Array<{slug: string, icon: string, name: string, description: string, color: string}>}
 */
export function listModes() {
  return Object.values(MODES).map(({ slug, icon, name, description, color }) => ({
    slug,
    icon,
    name,
    description,
    color,
  }));
}

/**
 * Detecta el modo más probable a partir de texto en lenguaje natural.
 * Usa coincidencia de palabras clave con scoring de confianza.
 *
 * @param {string} input - Texto del usuario en lenguaje natural
 * @returns {{ mode: string|null, confidence: number, matchedKeywords: string[] }}
 */
export function detectModeFromInput(input) {
  if (!input || typeof input !== "string") {
    return { mode: null, confidence: 0, matchedKeywords: [] };
  }

  const lowerInput = input.toLowerCase();
  const scores = {};

  for (const [mode, keywords] of Object.entries(MODE_KEYWORDS)) {
    const matched = keywords.filter((kw) => lowerInput.includes(kw.toLowerCase()));
    if (matched.length > 0) {
      // Confidence based on ratio of matched keywords to total possible
      // Also bonus for longer/more specific matches
      const rawScore = matched.length / keywords.length;
      const lengthBonus = matched.reduce((sum, kw) => sum + kw.length, 0) / 500; // small bonus for specific words
      scores[mode] = Math.min(rawScore + lengthBonus, 1.0);
    }
  }

  // Find mode with highest confidence
  let bestMode = null;
  let bestConfidence = 0;
  let bestKeywords = [];

  for (const [mode, score] of Object.entries(scores)) {
    if (score > bestConfidence) {
      bestConfidence = score;
      bestMode = mode;
      bestKeywords = MODE_KEYWORDS[mode].filter((kw) =>
        lowerInput.includes(kw.toLowerCase())
      );
    }
  }

  return {
    mode: bestMode,
    confidence: Math.round(bestConfidence * 100) / 100,
    matchedKeywords: bestKeywords,
  };
}

/**
 * Get the default model type for a given mode slug.
 * @param {string} modeSlug
 * @returns {string} "free" | "cheap" | "reasoner"
 */
export function getModelForMode(modeSlug) {
  const mode = MODES[modeSlug];
  return mode?.defaultModel || "cheap";
}

/**
 * Returns the OpenAI-compatible tool definition for the internal
 * `request_mode_switch` tool. This tool is injected into all modes
 * so the LLM can autonomously request a mode switch when it determines
 * its current tools are insufficient for the task.
 *
 * @returns {object} Tool definition in OpenAI format
 */
export function getModeSwitchToolSpec() {
  return {
    type: "function",
    function: {
      name: "request_mode_switch",
      description: "Request to switch to a different operating mode. Use this when you determine that your current mode's tools are insufficient to fulfill the user's request — e.g., you need to write code but are in Ask mode, or need to design architecture but are in Code mode. The user will be prompted to approve the switch.",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["architect", "code", "ask", "debug", "orchestrator"],
            description: "The target mode you want to switch to.",
          },
          reason: {
            type: "string",
            description: "Clear explanation of why this mode switch is necessary. Include what you need to do that the current mode cannot accomplish.",
          },
        },
        required: ["mode", "reason"],
      },
    },
  };
}

/**
 * Returns the OpenAI-compatible tool definition for the internal
 * `ask_followup_question` tool. This tool is injected into all modes
 * so the LLM can ask the user questions when it needs clarification.
 *
 * @returns {object} Tool definition in OpenAI format
 */
export function getAskFollowupQuestionToolSpec() {
    return {
        type: "function",
        function: {
            name: "ask_followup_question",
            description: "Ask the user a question to gather additional information needed to proceed. Use this when you need clarification, missing parameters, or the user's preference before continuing. The question will appear in the UI and the user can select from suggested answers or type their own.",
            parameters: {
                type: "object",
                properties: {
                    question: {
                        type: "string",
                        description: "The question to ask the user. Be clear and specific."
                    },
                    follow_up: {
                        type: "array",
                        description: "2-4 suggested answers the user can pick from. Each suggestion should be a complete, actionable answer.",
                        items: {
                            type: "object",
                            properties: {
                                text: { type: "string", description: "The suggested answer text" },
                                mode: { type: "string", description: "Optional mode slug to switch to if this suggestion is chosen" }
                            },
                            required: ["text"]
                        }
                    }
                },
                required: ["question", "follow_up"]
            }
        }
    };
}

/**
 * Returns available modes info formatted for injection into system prompts.
 * @returns {string} Markdown-formatted mode descriptions
 */
export function getModeDescriptions() {
  return Object.values(MODES)
    .map(
      (m) =>
        `- **${m.icon} ${m.name}** (\`${m.slug}\`): ${m.description}` +
        (m.allowedTools === "*"
          ? " — Has access to all tools."
          : ` — Limited to: ${m.allowedTools.filter(t => t !== "request_mode_switch").join(", ")}.`)
    )
    .join("\n");
}

// ─── Default Export ──────────────────────────────────────────────────────────

export default {
  MODES,
  getMode,
  getAllowedTools,
  getAllowedFilePatterns,
  canEditFile,
  isToolAllowed,
  listModes,
  detectModeFromInput,
  getModeSwitchToolSpec,
  getModeDescriptions,
  MODE_KEYWORDS,
};
