/**
 * lv-zero — Mode Controller
 *
 * v1.0
 *   Controla el cambio de modos del agente. Cada modo tiene su propio
 *   system prompt, herramientas permitidas y restricciones de archivos.
 *   El controlador preserva el contexto de la conversación al cambiar
 *   de modo y notifica al UI mediante eventos.
 *
 * Uso:
 *   import { ModeController } from "./modes/mode_controller.js";
 *
 *   const mc = new ModeController(orchestrator);
 *   await mc.switchMode("debug");
 *   mc.isToolAllowed("write_to_file");  // → true (debug has all tools)
 *   mc.canEditFile("src/secret.txt");   // → true
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  getMode,
  isToolAllowed as registryIsToolAllowed,
  canEditFile as registryCanEditFile,
  listModes,
  detectModeFromInput,
} from "./mode_registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Prompt Cache ────────────────────────────────────────────────────────────

const promptCache = {};

/**
 * Lee el contenido de un archivo de system prompt para un modo.
 * Los prompts se cachean en memoria para evitar lecturas repetidas.
 *
 * @param {string} promptFile - Nombre del archivo (sin extensión), ej: "architect", "code"
 * @returns {Promise<string>} Contenido del system prompt en markdown
 */
async function loadPromptContent(promptFile) {
  if (promptCache[promptFile]) {
    return promptCache[promptFile];
  }

  const promptPath = path.resolve(__dirname, "prompts", `${promptFile}.md`);

  try {
    if (!fs.existsSync(promptPath)) {
      console.warn(`[ModeController] Prompt no encontrado: ${promptPath}`);
      return `# ${promptFile} Mode\n\nEres un asistente en modo ${promptFile}.`;
    }

    const content = fs.readFileSync(promptPath, "utf-8");
    promptCache[promptFile] = content;
    return content;
  } catch (err) {
    console.error(`[ModeController] Error leyendo prompt ${promptPath}: ${err.message}`);
    return `# ${promptFile} Mode\n\nEres un asistente en modo ${promptFile}.`;
  }
}

/**
 * Invalida la caché de prompts (útil cuando se editan los archivos .md).
 */
export function invalidatePromptCache() {
  Object.keys(promptCache).forEach((key) => delete promptCache[key]);
}

// ─── Mode Controller Class ──────────────────────────────────────────────────

export class ModeController {
  /**
   * @param {object} orchestrator - Referencia al Orchestrator para acceder a this.messages, this.cacheLoop, etc.
   */
  constructor(orchestrator) {
    /** @type {object} Referencia al Orchestrator */
    this.orchestrator = orchestrator;

    /** @type {string} Modo activo actual (slug) */
    this.currentMode = "orchestrator"; // default mode

    /** @type {Array} Historial de cambios de modo { from, to, timestamp, reason } */
    this.history = [];

    /** @type {object|null} Contexto guardado del modo anterior (para restauración futura) */
    this._savedContexts = {};

    /** @type {boolean} Si está en medio de un cambio de modo */
    this._switching = false;
  }

  /**
   * Cambia al modo especificado.
   *
   * Proceso:
   *   1. Guarda el contexto actual
   *   2. Carga el nuevo system prompt
   *   3. Reemplaza el system prompt en this.messages
   *   4. Reconstruye el CacheFirstLoop prefix
   *   5. Emite evento mode_changed
   *   6. Guarda en RooState
   *
   * @param {string} modeSlug - Modo destino (architect, code, ask, debug)
   * @param {string} [reason] - Razón del cambio (auto-detected, manual, etc.)
   * @returns {Promise<{success: boolean, from: string, to: string, error?: string}>}
   */
  async switchMode(modeSlug, reason = "manual") {
    if (this._switching) {
      return { success: false, from: this.currentMode, to: modeSlug, error: "Already switching" };
    }

    const targetMode = getMode(modeSlug);
    if (!targetMode) {
      return { success: false, from: this.currentMode, to: modeSlug, error: `Unknown mode: ${modeSlug}` };
    }

    const fromMode = this.currentMode;

    if (fromMode === modeSlug) {
      return { success: true, from: fromMode, to: modeSlug }; // already in this mode
    }

    this._switching = true;

    try {
      // 1. Save current context (if not the default empty state)
      if (this.orchestrator.messages.length > 1) {
        this._savedContexts[fromMode] = {
          messages: [...this.orchestrator.messages],
          workflowActive: this.orchestrator.workflowActive,
          savedAt: Date.now(),
        };
      }

      // 2. Load new system prompt
      const newPrompt = await loadPromptContent(targetMode.systemPromptFile);

      // 3. Replace system prompt in messages array
      const systemIndex = this.orchestrator.messages.findIndex((m) => m.role === "system");
      if (systemIndex !== -1) {
        this.orchestrator.messages[systemIndex] = {
          role: "system",
          content: newPrompt,
        };
      } else {
        // No system message yet — add one (shouldn't happen normally)
        this.orchestrator.messages.unshift({ role: "system", content: newPrompt });
      }

      // 4. Update orchestrator's systemPrompt reference
      this.orchestrator.systemPrompt = newPrompt;

      // 5. Rebuild CacheFirstLoop prefix with new system prompt
      const tools = this.orchestrator.skillsToTools();
      this.orchestrator.cacheLoop.rebuildPrefix(newPrompt, tools);

      // 6. Update active mode
      this.currentMode = modeSlug;

      // 7. Log the switch
      const entry = {
        from: fromMode,
        to: modeSlug,
        timestamp: new Date().toISOString(),
        reason,
      };
      this.history.push(entry);

      // 8. Emit event
      this.orchestrator.emit("mode_changed", {
        from: fromMode,
        to: modeSlug,
        icon: targetMode.icon,
        name: targetMode.name,
        color: targetMode.color,
        reason,
        timestamp: entry.timestamp,
      });

      this.orchestrator.emit("log", `   🔄 Modo cambiado: ${fromMode} → ${modeSlug} (${reason})`);
      this.orchestrator.emit("log", `   📋 Herramientas: ${targetMode.allowedTools === "*" ? "Todas" : targetMode.allowedTools.join(", ")}`);

      return { success: true, from: fromMode, to: modeSlug };
    } catch (err) {
      this.orchestrator.emit("error", {
        type: "mode_switch",
        message: `Error switching to ${modeSlug}: ${err.message}`,
      });
      return { success: false, from: fromMode, to: modeSlug, error: err.message };
    } finally {
      this._switching = false;
    }
  }

  /**
   * Obtiene la configuración completa del modo actual.
   * @returns {object|null} Modo actual
   */
  getCurrentModeConfig() {
    return getMode(this.currentMode);
  }

  /**
   * Verifica si una herramienta está permitida en el modo actual.
   * @param {string} toolName - Nombre de la herramienta
   * @returns {boolean} True si está permitida
   */
  isToolAllowed(toolName) {
    return registryIsToolAllowed(this.currentMode, toolName);
  }

  /**
   * Verifica si un archivo puede ser editado en el modo actual.
   * @param {string} filePath - Ruta del archivo
   * @returns {boolean} True si se puede editar
   */
  canEditFile(filePath) {
    return registryCanEditFile(this.currentMode, filePath);
  }

  /**
   * Filtra un array de tools (formato OpenAI) según el modo actual.
   * Si el modo tiene "allowedTools: '*'", devuelve todas las tools sin filtrar.
   * Si el modo tiene una lista, solo devuelve las que están en la lista.
   *
   * @param {Array} tools - Tools en formato OpenAI (type: "function", function: { name, ... })
   * @returns {Array} Tools filtradas
   */
  filterTools(tools) {
    const modeConfig = getMode(this.currentMode);
    if (!modeConfig) return tools;

    const allowed = modeConfig.allowedTools;
    if (allowed === "*") return tools;

    return tools.filter((tool) => {
      const toolName = tool.function?.name || tool.name;
      return allowed.includes(toolName);
    });
  }

  /**
   * Detecta el modo sugerido a partir del input del usuario.
   * Usa coincidencia de palabras clave con confidence scoring.
   *
   * @param {string} userInput - Texto del usuario
   * @returns {{ detected: string|null, confidence: number, matchedKeywords: string[], shouldSuggest: boolean }}
   */
  detectFromInput(userInput) {
    const result = detectModeFromInput(userInput);

    let shouldSuggest = false;
    if (result.mode && result.mode !== this.currentMode) {
      // Sugerir cambio si hay suficiente confianza
      shouldSuggest = result.confidence >= 0.3;
    }

    return {
      ...result,
      shouldSuggest,
    };
  }

  /**
   * Obtiene el historial de cambios de modo.
   * @param {number} [limit] - Número máximo de entradas a devolver
   * @returns {Array} Historial de cambios
   */
  getHistory(limit) {
    const entries = [...this.history].reverse();
    return limit ? entries.slice(0, limit) : entries;
  }

  /**
   * Obtiene información del modo actual para el status.
   * @returns {{ slug: string, icon: string, name: string, color: string, description: string }}
   */
  getStatus() {
    const mode = getMode(this.currentMode);
    if (!mode) {
      return { slug: "orchestrator", icon: "🔄", name: "Orchestrator", color: "#FF6B35", description: "Default mode" };
    }
    return {
      slug: mode.slug,
      icon: mode.icon,
      name: mode.name,
      color: mode.color,
      description: mode.description,
    };
  }

  /**
   * Resetea el controlador (vuelve a orchestrator mode por defecto).
   */
  reset() {
    this.currentMode = "orchestrator";
    this._savedContexts = {};
    this._switching = false;
  }
}

// ─── Default Export ──────────────────────────────────────────────────────────

export default ModeController;
