/**
 * lv-zero — Workflow Loader Engine
 *
 * v1.0
 *   Motor que carga registry.json, resuelve comandos slash (/plan, /code, etc.),
 *   lee los archivos .md de workflow y los devuelve como instrucciones
 *   estructuradas para inyectar en el contexto del agente.
 *
 * Uso:
 *   import { resolveCommand, getWorkflow, listWorkflows } from "./workflows/loader.js";
 *
 *   const resolved = resolveCommand("/design");    // → { command: "/plan", workflow: "lifecycle/plan.md", ... }
 *   const workflow = await getWorkflow("/plan");    // → "## Step 1: Analyze Requirements..."
 *   const all = listWorkflows();                    // → [{ command: "/plan", ... }, ...]
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Paths ──────────────────────────────────────────────────────────────────

const REGISTRY_PATH = path.resolve(__dirname, "registry.json");
const WORKFLOWS_DIR = path.resolve(__dirname);

// ─── Cache ──────────────────────────────────────────────────────────────────

let registry = null;
let workflowCache = {};

// ─── Registry Loading ───────────────────────────────────────────────────────

/**
 * Carga el registro de comandos desde registry.json.
 * @returns {object} El objeto de registro completo.
 */
function loadRegistry() {
  if (registry) return registry;
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, "utf-8");
    registry = JSON.parse(raw);
    return registry;
  } catch (err) {
    console.error(`[WorkflowLoader] Error cargando registry.json: ${err.message}`);
    return { commands: {}, categories: {} };
  }
}

/**
 * Recarga el registro (invalida caché).
 * @returns {object} El objeto de registro recargado.
 */
function reloadRegistry() {
  registry = null;
  workflowCache = {};
  return loadRegistry();
}

// ─── Command Resolution ─────────────────────────────────────────────────────

/**
 * Resuelve un comando slash o alias a su definición completa.
 *
 * @param {string} input - El comando o alias (ej: "/plan", "/design", "plan")
 * @returns {object|null} La definición del comando o null si no se encuentra.
 *   { command: "/plan", workflow: "lifecycle/plan.md", description: "...", aliases: [...], category: "lifecycle" }
 */
function resolveCommand(input) {
  const reg = loadRegistry();
  const commands = reg.commands || {};

  // Normalize: ensure leading slash
  const normalized = input.startsWith("/") ? input : `/${input}`;
  const cmdKey = normalized.toLowerCase();

  // Direct match
  if (commands[cmdKey]) {
    return { command: cmdKey, ...commands[cmdKey] };
  }

  // Alias match
  for (const [cmd, def] of Object.entries(commands)) {
    const aliases = (def.aliases || []).map((a) => a.toLowerCase());
    if (aliases.includes(cmdKey)) {
      return { command: cmd, ...def };
    }
  }

  return null;
}

/**
 * Verifica si un texto contiene un comando slash conocido.
 * Útil para autocompletado y sugerencias.
 *
 * @param {string} text - Texto a analizar
 * @returns {object|null} El comando encontrado o null
 */
function detectCommand(text) {
  if (!text || typeof text !== "string") return null;

  // Match /command at start of text
  const match = text.match(/^\/(\w+)/);
  if (!match) return null;

  return resolveCommand(match[1]);
}

// ─── Workflow Loading ───────────────────────────────────────────────────────

/**
 * Obtiene el contenido completo de un workflow como texto estructurado.
 * Busca por comando slash (ej: "/plan") o alias.
 *
 * @param {string} command - El comando slash (ej: "/plan", "/code")
 * @returns {string|null} El contenido del workflow en markdown, o null si no existe.
 */
async function getWorkflow(command) {
  const resolved = resolveCommand(command);
  if (!resolved) return null;

  const workflowPath = path.resolve(WORKFLOWS_DIR, resolved.workflow);

  // Check cache
  if (workflowCache[workflowPath]) {
    return workflowCache[workflowPath];
  }

  try {
    if (!fs.existsSync(workflowPath)) {
      console.error(`[WorkflowLoader] Workflow no encontrado: ${workflowPath}`);
      return null;
    }

    const content = fs.readFileSync(workflowPath, "utf-8");
    workflowCache[workflowPath] = content;
    return content;
  } catch (err) {
    console.error(`[WorkflowLoader] Error leyendo ${workflowPath}: ${err.message}`);
    return null;
  }
}

/**
 * Obtiene el workflow como instrucciones formateadas para el agente.
 * Incluye el nombre del workflow, descripción, y pasos.
 *
 * @param {string} command - El comando slash (ej: "/plan")
 * @returns {string|null} Instrucciones formateadas para el agente.
 */
async function getWorkflowInstructions(command) {
  const resolved = resolveCommand(command);
  if (!resolved) return null;

  const content = await getWorkflow(command);
  if (!content) return null;

  const header = `[WORKFLOW: ${resolved.command}]\nDescripción: ${resolved.description}\n\n`;

  return header + content;
}

/**
 * Obtiene SOLO los pasos de un workflow (sin el encabezado markdown).
 *
 * @param {string} command - El comando slash
 * @returns {string|null} Solo los pasos del workflow.
 */
async function getWorkflowSteps(command) {
  const content = await getWorkflow(command);
  if (!content) return null;

  // Strip markdown title (first line starting with #)
  const lines = content.split("\n");
  const steps = lines.filter((line) => !line.trim().startsWith("#") || line.trim().startsWith("##"));
  return steps.join("\n").trim();
}

// ─── Listing ────────────────────────────────────────────────────────────────

/**
 * Lista todos los workflows disponibles, con sus descripciones y aliases.
 *
 * @returns {Array<{command: string, description: string, aliases: string[], category: string}>}
 */
function listWorkflows() {
  const reg = loadRegistry();
  const commands = reg.commands || {};

  return Object.entries(commands).map(([cmd, def]) => ({
    command: cmd,
    description: def.description,
    aliases: def.aliases || [],
    category: def.category,
  }));
}

/**
 * Obtiene las categorías de workflows.
 *
 * @returns {object} Mapa de categorías.
 */
function getCategories() {
  const reg = loadRegistry();
  return reg.categories || {};
}

/**
 * Mapa de palabras clave por workflow con pesos de confianza.
 * Cubre español e inglés para detección natural multilingüe.
 */
const INTENT_KEYWORDS = {
  "/plan": [
    "plan", "arquitectura", "diseñar", "design", "architecture",
    "estructura", "diagrama", "estructurar", "organizar", "componentes",
    "flujo", "data flow", "schema", "diseño", "planear", "planea",
    "planeación", "mapear", "map", "estructuración",
  ],
  "/code": [
    "implement", "código", "codigo", "code", "build", "crear", "create",
    "develop", "function", "class", "escribir", "write", "programar",
    "desarrollar", "module", "componente", "api", "endpoint", "función",
    "funcion", "módulo", "modulo", "implementa", "implementar",
  ],
  "/debug": [
    "debug", "error", "bug", "fix", "arreglar", "corregir", "falla",
    "fail", "issue", "problema", "exception", "stack trace", "crash",
    "no funciona", "broken", "mal", "incorrecto", "wrong", "failed",
    "tira error", "marca error", "da error", "está mal", "esta mal",
    "falló", "fallo", "exception", "break", "peta", "peta",
  ],
  "/review": [
    "review", "revisar", "audit", "calidad", "quality", "code review",
    "inspeccionar", "inspección", "inspeccion", "evaluar", "evaluate",
    "check", "revisión", "revision", "auditar", "validar",
  ],
};

/**
 * Patrones de negación: si el input contiene frases como "no es un error",
 * se descarta la coincidencia con /debug para evitar falsos positivos.
 */
const NEGATION_PATTERNS = [
  /\bno\s+(es|hay|tiene|debe|era|fue)\s+(un\s+|una\s+)?(error|bug|problema|falla)\b/i,
  /\b(esto|eso|aquello)\s+no\s+(es|era|fue)\s+(un\s+|una\s+)?(error|bug|problema)\b/i,
  /\bsin\s+(errores|bugs|problemas)\b/i,
  /\bno\s+(encuentro|veo|tengo)\s+(ningún|ningun)\s+(error|bug|problema)\b/i,
];

/**
 * Verifica si el input contiene patrones de negación que invalidan
 * la detección de un workflow específico.
 *
 * @param {string} input - Texto del usuario
 * @param {string} command - Comando a verificar (ej: "/debug")
 * @returns {boolean} true si el input niega el contexto del workflow
 */
function isNegated(input, command) {
  if (command !== "/debug") return false; // Solo aplica a debug por ahora
  return NEGATION_PATTERNS.some((pattern) => pattern.test(input));
}

/**
 * Obtiene sugerencias de comandos con puntuación de confianza mejorada.
 * Busca palabras clave en español e inglés y acumula confianza por
 * cada keyword adicional que coincida (+0.15 por match, máx 0.95).
 * Aplica detección de negación para evitar falsos positivos.
 *
 * @param {string} input - Texto del usuario
 * @returns {Array<{command: string, confidence: number}>} Comandos sugeridos con nivel de confianza
 */
function suggestCommand(input) {
  if (!input || typeof input !== "string") return [];

  const lower = input.toLowerCase();

  // Contar coincidencias por workflow
  const matchCounts = {};
  for (const [cmd, keywords] of Object.entries(INTENT_KEYWORDS)) {
    let count = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        count++;
      }
    }
    if (count > 0) {
      // Base 0.5 + 0.15 por cada keyword adicional (max 0.95)
      const confidence = Math.min(0.5 + (count - 1) * 0.15, 0.95);
      matchCounts[cmd] = { count, confidence };
    }
  }

  // Aplicar negación: si el input niega /debug, reducir drásticamente su confianza
  if (matchCounts["/debug"] && isNegated(input, "/debug")) {
    matchCounts["/debug"].confidence = Math.min(matchCounts["/debug"].confidence, 0.3);
  }

  // Convertir a array ordenado por confianza descendente
  const suggestions = Object.entries(matchCounts)
    .map(([command, { confidence }]) => ({ command, confidence }))
    .sort((a, b) => b.confidence - a.confidence);

  return suggestions;
}

/**
 * Parsea el contenido de un workflow en markdown para extraer
 * los pasos estructurados con nombre y número.
 *
 * @param {string} command - Comando slash (ej: "/debug")
 * @returns {Promise<Array<{step: number, name: string}>|null>}
 */
async function parseWorkflowSteps(command) {
  const content = await getWorkflow(command);
  if (!content) return null;

  const lines = content.split("\n");
  const steps = [];
  let currentStep = 0;

  for (const line of lines) {
    // Match "## Paso N: Title" or "## Step N: Title"
    const match = line.match(/^##\s*(?:Paso|Step|Paso|Paso)\s*(\d+)\s*[.:]?\s*(.+)/i);
    if (match) {
      currentStep = parseInt(match[1], 10);
      steps.push({
        step: currentStep,
        name: match[2].trim(),
      });
    }
  }

  return steps.length > 0 ? steps : null;
}

/**
 * Obtiene el número total de pasos de un workflow.
 *
 * @param {string} command - Comando slash
 * @returns {Promise<number|null>}
 */
async function getStepCount(command) {
  const steps = await parseWorkflowSteps(command);
  return steps ? steps.length : null;
}

/**
 * Obtiene los nombres de los pasos de un workflow.
 *
 * @param {string} command - Comando slash
 * @returns {Promise<Array<string>|null>}
 */
async function getStepNames(command) {
  const steps = await parseWorkflowSteps(command);
  return steps ? steps.map((s) => s.name) : null;
}

// ─── Intent Detection (Antigravity-style) ────────────────────────────────────

/**
 * Umbral de confianza para auto-activar un workflow sin intervención del usuario.
 * Si la confianza es >= AUTO_ACTIVATE_THRESHOLD, el workflow se inyecta
 * silenciosamente como contexto del sistema, sin preguntar al usuario.
 */
const AUTO_ACTIVATE_THRESHOLD = 0.7;

/**
 * Detecta si el input del usuario es un comando slash, un alias, o
 * contiene palabras clave que sugieran un workflow.
 *
 * Flujo de detección:
 * 1. Slash command directo → type: "command" (siempre se activa)
 * 2. Keywords con confianza >= 0.7 → type: "command" (auto-activación silenciosa)
 * 3. Keywords con confianza entre 0.4 y 0.69 → type: "suggestion"
 * 4. Sin coincidencias → type: null
 *
 * @param {string} input - Input del usuario
 * @returns {{ type: "command"|"suggestion"|null, command: string, workflow: object|null, confidence: number }}
 */
function detectIntent(input) {
  if (!input || typeof input !== "string") {
    return { type: null, command: null, workflow: null, confidence: 0 };
  }

  // 1. Direct slash command — extract just the command part (before space)
  if (input.startsWith("/")) {
    const cmdPart = input.split(/\s+/)[0]; // "/review" from "/review app.js"
    const resolved = resolveCommand(cmdPart);
    if (resolved) {
      return { type: "command", command: resolved.command, workflow: resolved, confidence: 1.0 };
    }
  }

  // 2. Intent detection via keywords with confidence scoring
  const suggestions = suggestCommand(input);
  if (suggestions.length > 0) {
    // Return highest confidence match
    const best = suggestions.reduce((a, b) => (a.confidence > b.confidence ? a : b));
    const resolved = resolveCommand(best.command);
    if (resolved) {
      // Auto-activate if confidence >= threshold
      if (best.confidence >= AUTO_ACTIVATE_THRESHOLD) {
        return {
          type: "command",
          command: resolved.command,
          workflow: resolved,
          confidence: best.confidence,
        };
      }
      // Otherwise, suggest to the user
      return {
        type: "suggestion",
        command: resolved.command,
        workflow: resolved,
        confidence: best.confidence,
      };
    }
  }

  return { type: null, command: null, workflow: null, confidence: 0 };
}

// ─── Help Text ──────────────────────────────────────────────────────────────

/**
 * Genera texto de ayuda listando todos los workflows disponibles.
 *
 * @returns {string} Texto formateado para mostrar al usuario.
 */
function getHelpText() {
  const workflows = listWorkflows();
  const categories = getCategories();

  let text = "📋 **Workflows Disponibles:**\n\n";

  for (const [catId, cat] of Object.entries(categories)) {
    text += `**${cat.name}:** ${cat.description}\n`;
    const catWorkflows = workflows.filter((w) => w.category === catId);
    for (const w of catWorkflows) {
      const aliasStr = w.aliases.length > 0 ? ` (${w.aliases.join(", ")})` : "";
      text += `  • \`${w.command}\`${aliasStr} — ${w.description}\n`;
    }
    text += "\n";
  }

  text += "**Uso:** Escribe `/plan`, `/code`, `/debug` o `/review` seguido de tu solicitud.\n";
  text += "**Ejemplo:** `/code Crea un endpoint REST para usuarios`";

  return text;
}

// ─── Export ─────────────────────────────────────────────────────────────────

export {
  loadRegistry,
  reloadRegistry,
  resolveCommand,
  detectCommand,
  getWorkflow,
  getWorkflowInstructions,
  getWorkflowSteps,
  listWorkflows,
  getCategories,
  suggestCommand,
  detectIntent,
  getHelpText,
  parseWorkflowSteps,
  getStepCount,
  getStepNames,
};

export default {
  resolveCommand,
  detectCommand,
  getWorkflow,
  getWorkflowInstructions,
  getWorkflowSteps,
  listWorkflows,
  getCategories,
  suggestCommand,
  detectIntent,
  getHelpText,
  parseWorkflowSteps,
  getStepCount,
  getStepNames,
  loadRegistry,
  reloadRegistry,
};
