/**
 * lv-zero — StateManager (Persistencia)
 *
 * v2.1 — Session Persistence & State Management + RooState Crash Recovery
 *   - Guardado automático de la sesión en .lv-zero/session.json
 *   - Sesiones múltiples en _roo/sessions/ con metadatos (mode, projectPath)
 *   - Exportación a Markdown de sesiones
 *   - Auto-guardado cada N mensajes en _roo/sessions/auto/ con rotación
 *   - RooState: checkpointing para crash recovery (saveRooState/loadRooState/clearRooState)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Configuration ──────────────────────────────────────────────────────────
const CONFIG = {
  // Directorio oculto donde se guarda el estado actual
  SESSION_DIR: path.resolve(__dirname, "..", "..", ".lv-zero"),
  // Archivo de sesión (session activa)
  SESSION_FILE: "session.json",
  // Archivo de RooState (crash recovery checkpoint)
  ROO_STATE_FILE: "roo-state.json",
  // Directorio de sesiones múltiples (para export/restore)
  SESSIONS_DIR: path.resolve(__dirname, "..", "..", "_roo", "sessions"),
  // Subdirectorio para auto-saves (rotación)
  AUTO_SAVE_DIR: path.resolve(__dirname, "..", "..", "_roo", "sessions", "auto"),
  // Archivo de último checkpoint (para restore en init)
  LAST_SESSION_FILE: path.resolve(__dirname, "..", "..", "_roo", "sessions", "last.json"),
  // Intervalo de autoguardado en ms (cada 5s)
  AUTO_SAVE_INTERVAL: 5000,
  // Cada cuántos mensajes se guarda un auto-checkpoint en _roo/sessions/auto/
  AUTO_CHECKPOINT_INTERVAL: 5,
  // Máximo de auto-checkpoints a conservar (rotación FIFO)
  MAX_AUTO_CHECKPOINTS: 10,
  // Máximo de mensajes a persistir (evita archivos enormes)
  MAX_PERSISTED_MESSAGES: 100,
};

// ─── State ──────────────────────────────────────────────────────────────────
let sessionState = {
  sessionId: null,
  startedAt: null,
  lastActivity: null,
  mode: null,
  projectPath: null,
  planStep: 0,
  planTotal: 0,
  planDescription: "",
  messageCount: 0,
  skillsCount: 0,
  toolCallsExecuted: 0,
  messages: [],
  forcedModel: null,
  currentProvider: null,
  currentTier: null,
};

let autoSaveTimer = null;
let isDirty = false;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getStateFilePath() {
  return path.join(CONFIG.SESSION_DIR, CONFIG.SESSION_FILE);
}

function getRooStateFilePath() {
  return path.join(CONFIG.SESSION_DIR, CONFIG.ROO_STATE_FILE);
}

function ensureSessionDir() {
  const dir = CONFIG.SESSION_DIR;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    // Hide directory on Windows
    try {
      fs.writeFileSync(path.join(dir, ".gitkeep"), "");
    } catch (_) {
      // ignore
    }
  }
}

function ensureSessionsDir() {
  const dirs = [CONFIG.SESSIONS_DIR, CONFIG.AUTO_SAVE_DIR];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Generates a filename-safe session name from metadata.
 * @param {{ mode?: string, projectPath?: string }} meta
 * @returns {string}
 */
function generateSessionName(meta = {}) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, "-"); // HH-MM-SS
  const mode = meta.mode || "unknown";
  const label = meta.sessionLabel || "";
  const parts = [dateStr, timeStr, mode, label].filter(Boolean);
  return parts.join("_").replace(/[^a-zA-Z0-9_\-]/g, "");
}

/**
 * Parses a session metadata file.
 * @param {string} filePath
 * @returns {object|null}
 */
function readSessionFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── Core API ───────────────────────────────────────────────────────────────

/**
 * Genera un ID de sesión único.
 */
function generateSessionId() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `LV-${timestamp}-${random}`;
}

/**
 * Inicializa o recupera una sesión.
 * Si existe session.json, restaura el estado.
 * Si no, crea una nueva sesión.
 *
 * @param {{ mode?: string, projectPath?: string }} [options]
 * @returns {{ restored: boolean, sessionId: string }}
 */
export function initSession(options = {}) {
  ensureSessionDir();
  const stateFile = getStateFilePath();

  if (fs.existsSync(stateFile)) {
    try {
      const raw = fs.readFileSync(stateFile, "utf-8");
      const saved = JSON.parse(raw);

      // Validate saved state structure
      if (saved && saved.sessionId && saved.startedAt) {
        sessionState = {
          ...sessionState,
          ...saved,
          mode: options.mode || saved.mode || null,
          projectPath: options.projectPath || saved.projectPath || null,
          lastActivity: new Date().toISOString(),
        };
        console.log(
          `   📂 Sesión recuperada: ${saved.sessionId} (${saved.messageCount} mensajes previos)`
        );
        return { restored: true, sessionId: sessionState.sessionId };
      }
    } catch (err) {
      console.warn(`   ⚠️  Error recuperando sesión: ${err.message}. Creando nueva.`);
    }
  }

  // New session
  sessionState = {
    sessionId: generateSessionId(),
    startedAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    mode: options.mode || null,
    projectPath: options.projectPath || null,
    planStep: 0,
    planTotal: 0,
    planDescription: "",
    messageCount: 0,
    skillsCount: 0,
    toolCallsExecuted: 0,
    messages: [],
  };

  // Save initial state
  saveSessionSync();
  console.log(`   📂 Nueva sesión: ${sessionState.sessionId}`);

  return { restored: false, sessionId: sessionState.sessionId };
}

/**
 * Guarda el estado actual de la sesión en el archivo.
 * Filtra mensajes para no persistir el historial completo si es muy grande.
 */
export function saveSessionSync() {
  try {
    ensureSessionDir();
    sessionState.lastActivity = new Date().toISOString();

    // Truncate messages to avoid huge files
    const messagesToPersist =
      sessionState.messages.length > CONFIG.MAX_PERSISTED_MESSAGES
        ? [
            ...sessionState.messages.slice(0, 3), // Keep first 3 (system + recent)
            ...sessionState.messages.slice(-(CONFIG.MAX_PERSISTED_MESSAGES - 3)),
          ]
        : sessionState.messages;

    const stateToSave = {
      ...sessionState,
      messages: messagesToPersist,
    };

    // Atomic write: write to temp file first, then rename
    const tmpPath = getStateFilePath() + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(stateToSave, null, 2), "utf-8");
    fs.renameSync(tmpPath, getStateFilePath());
    isDirty = false;
  } catch (err) {
    console.warn(`   ⚠️  Error guardando sesión: ${err.message}`);
  }
}

/**
 * Versión async de saveSessionSync (para uso en flujos async).
 */
export async function saveSession() {
  saveSessionSync();
}

/**
 * Actualiza un campo del estado de la sesión y marca como dirty.
 * @param {string} key - Campo a actualizar
 * @param {any} value - Valor
 */
export function updateState(key, value) {
  if (key in sessionState) {
    sessionState[key] = value;
    isDirty = true;
  }
}

/**
 * Actualiza múltiples campos del estado.
 * @param {object} updates - Objeto con campos a actualizar
 */
export function updateStateBatch(updates) {
  let changed = false;
  for (const [key, value] of Object.entries(updates)) {
    if (key in sessionState) {
      sessionState[key] = value;
      changed = true;
    }
  }
  if (changed) isDirty = true;
}

/**
 * Actualiza el progreso del plan.
 * @param {number} step - Paso actual
 * @param {number} total - Total de pasos
 * @param {string} description - Descripción del plan
 */
export function updatePlanProgress(step, total, description) {
  sessionState.planStep = step;
  sessionState.planTotal = total;
  if (description) sessionState.planDescription = description;
  isDirty = true;
}

/**
 * Registra un mensaje en el historial persistido.
 * @param {object} message - Mensaje del historial de conversación
 */
export function trackMessage(message) {
  sessionState.messageCount++;
  sessionState.messages.push({
    role: message.role,
    timestamp: new Date().toISOString(),
    contentLength: message.content ? message.content.length : 0,
    hasToolCalls: !!message.tool_calls,
  });
  isDirty = true;
}

/**
 * Incrementa el contador de tool_calls ejecutadas.
 */
export function trackToolCall() {
  sessionState.toolCallsExecuted++;
  isDirty = true;
}

/**
 * Establece el conteo de skills cargadas.
 * @param {number} count
 */
export function setSkillsCount(count) {
  sessionState.skillsCount = count;
  isDirty = true;
}

/**
 * Obtiene el estado actual de la sesión (solo lectura).
 * @returns {object}
 */
export function getSessionState() {
  return { ...sessionState };
}

/**
 * Obtiene el ID de sesión actual.
 * @returns {string|null}
 */
export function getSessionId() {
  return sessionState.sessionId;
}

// ═════════════════════════════════════════════════════════════════════════
// 7.1 — Session naming / metadata
// ═════════════════════════════════════════════════════════════════════════

/**
 * Sets session metadata (mode, project path).
 * @param {{ mode?: string, projectPath?: string, sessionLabel?: string }} meta
 */
export function setSessionMetadata(meta) {
  if (meta.mode !== undefined) {
    sessionState.mode = meta.mode;
    isDirty = true;
  }
  if (meta.projectPath !== undefined) {
    sessionState.projectPath = meta.projectPath;
    isDirty = true;
  }
}

/**
 * Saves the full conversation as a named session file in _roo/sessions/.
 * Also updates _roo/sessions/last.json for restore-on-startup.
 * @param {object} [options]
 * @param {string} [options.sessionLabel] - Optional human-readable label
 * @returns {string} session file path
 */
export function saveSessionCheckpoint(options = {}) {
  ensureSessionsDir();
  const sessionName = generateSessionName({
    mode: sessionState.mode,
    projectPath: sessionState.projectPath,
    sessionLabel: options.sessionLabel,
  });
  const fileName = `${sessionName}.json`;
  const filePath = path.join(CONFIG.SESSIONS_DIR, fileName);

  // Build a full checkpoint with complete message metadata
  const checkpoint = {
    sessionId: sessionState.sessionId,
    startedAt: sessionState.startedAt,
    savedAt: new Date().toISOString(),
    mode: sessionState.mode,
    projectPath: sessionState.projectPath,
    messageCount: sessionState.messageCount,
    skillsCount: sessionState.skillsCount,
    toolCallsExecuted: sessionState.toolCallsExecuted,
    messages: sessionState.messages,
  };

  // Atomic write
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(checkpoint, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);

  // Also update last.json (for restore on startup)
  const lastPath = CONFIG.LAST_SESSION_FILE;
  fs.writeFileSync(lastPath + ".tmp", JSON.stringify(checkpoint, null, 2), "utf-8");
  fs.renameSync(lastPath + ".tmp", lastPath);

  return filePath;
}

// ═════════════════════════════════════════════════════════════════════════
// 7.2 — Session restore
// ═════════════════════════════════════════════════════════════════════════

/**
 * Checks if there's a saved session checkpoint (_roo/sessions/last.json).
 * @returns {{ exists: boolean, session?: object, filePath?: string }}
 */
export function checkLastSession() {
  const lastPath = CONFIG.LAST_SESSION_FILE;
  const session = readSessionFile(lastPath);
  if (!session || !session.sessionId) {
    return { exists: false };
  }
  return { exists: true, session, filePath: lastPath };
}

/**
 * Restores session state from a checkpoint file.
 * @param {string} filePath - Path to the session JSON file
 * @returns {{ restored: boolean, sessionId: string, messageCount: number }}
 */
export function restoreSession(filePath) {
  const session = readSessionFile(filePath);
  if (!session) {
    console.warn(`   ⚠️  No se pudo restaurar sesión desde: ${filePath}`);
    return { restored: false, sessionId: null, messageCount: 0 };
  }

  sessionState = {
    ...sessionState,
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    lastActivity: new Date().toISOString(),
    mode: session.mode || null,
    projectPath: session.projectPath || null,
    messageCount: session.messageCount || 0,
    skillsCount: session.skillsCount || 0,
    toolCallsExecuted: session.toolCallsExecuted || 0,
    messages: session.messages || [],
  };

  console.log(
    `   📂 Sesión restaurada: ${session.sessionId} (${sessionState.messageCount} mensajes)`
  );
  return { restored: true, sessionId: session.sessionId, messageCount: sessionState.messageCount };
}

/**
 * Removes the last session checkpoint (e.g. when user declines restore).
 */
export function clearLastSession() {
  const lastPath = CONFIG.LAST_SESSION_FILE;
  try {
    if (fs.existsSync(lastPath)) {
      fs.unlinkSync(lastPath);
    }
  } catch (_) {
    // ignore
  }
}

// ═════════════════════════════════════════════════════════════════════════
// 7.3 — Auto-save checkpoint every N messages (with rotation)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Saves an auto-checkpoint of the conversation to _roo/sessions/auto/.
 * Rotates oldest files when exceeding MAX_AUTO_CHECKPOINTS.
 * Call this after every N messages (N = CONFIG.AUTO_CHECKPOINT_INTERVAL).
 * @returns {string|null} saved file path, or null if skipped
 */
export function saveAutoCheckpoint() {
  if (sessionState.messages.length === 0) return null;

  ensureSessionsDir();
  const timestamp = Date.now();
  const fileName = `checkpoint-${timestamp}.json`;
  const filePath = path.join(CONFIG.AUTO_SAVE_DIR, fileName);

  const checkpoint = {
    sessionId: sessionState.sessionId,
    savedAt: new Date().toISOString(),
    mode: sessionState.mode,
    projectPath: sessionState.projectPath,
    messageCount: sessionState.messageCount,
    messages: sessionState.messages.slice(-20), // last 20 messages
  };

  // Atomic write
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(checkpoint, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);

  // Rotate old checkpoints
  rotateAutoCheckpoints();

  return filePath;
}

/**
 * Rotates auto-checkpoints, keeping only the MAX_AUTO_CHECKPOINTS most recent.
 */
function rotateAutoCheckpoints() {
  try {
    const autoDir = CONFIG.AUTO_SAVE_DIR;
    if (!fs.existsSync(autoDir)) return;

    const files = fs
      .readdirSync(autoDir)
      .filter((f) => f.startsWith("checkpoint-") && f.endsWith(".json"))
      .sort() // alphabetical = chronological by timestamp
      .reverse(); // newest first

    if (files.length > CONFIG.MAX_AUTO_CHECKPOINTS) {
      const toDelete = files.slice(CONFIG.MAX_AUTO_CHECKPOINTS);
      for (const file of toDelete) {
        fs.unlinkSync(path.join(autoDir, file));
      }
      console.log(`   🔄 Rotados ${toDelete.length} auto-checkpoints antiguos`);
    }
  } catch (_) {
    // ignore rotation errors
  }
}

/**
 * Lists all saved sessions in _roo/sessions/.
 * @returns {Array<{ filePath: string, sessionId: string, savedAt: string, mode: string|null, messageCount: number }>}
 */
export function listSessions() {
  ensureSessionsDir();
  try {
    const files = fs
      .readdirSync(CONFIG.SESSIONS_DIR)
      .filter((f) => f.endsWith(".json") && f !== "last.json")
      .sort()
      .reverse();

    return files
      .map((f) => {
        const filePath = path.join(CONFIG.SESSIONS_DIR, f);
        const session = readSessionFile(filePath);
        if (!session) return null;
        return {
          filePath,
          sessionId: session.sessionId,
          savedAt: session.savedAt || session.startedAt,
          mode: session.mode || null,
          messageCount: session.messageCount || 0,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Exports a session as a Markdown document.
 * @param {string} filePath - Path to the session JSON file
 * @returns {string|null} Markdown content, or null if file not found
 */
export function exportSession(filePath) {
  const session = readSessionFile(filePath);
  if (!session) return null;

  const lines = [];
  lines.push(`# Session Export: ${session.sessionId}`);
  lines.push("");
  lines.push(`- **Date:** ${session.startedAt || "N/A"}`);
  lines.push(`- **Mode:** ${session.mode || "N/A"}`);
  lines.push(`- **Project:** ${session.projectPath || "N/A"}`);
  lines.push(`- **Messages:** ${session.messageCount || 0}`);
  lines.push(`- **Tool Calls:** ${session.toolCallsExecuted || 0}`);
  lines.push("");

  if (session.messages && session.messages.length > 0) {
    lines.push("---");
    lines.push("");
    for (const msg of session.messages) {
      const role = msg.role || "unknown";
      const timestamp = msg.timestamp || "";
      const content = msg.content || "";
      const toolCalls = msg.tool_calls || [];

      lines.push(`### ${role.toUpperCase()}${timestamp ? ` — ${timestamp}` : ""}`);
      lines.push("");

      if (content) {
        lines.push(content);
        lines.push("");
      }

      if (toolCalls.length > 0) {
        for (const tc of toolCalls) {
          const fnName = tc.function?.name || "unknown";
          lines.push(`> **Tool Call:** \`${fnName}\``);
          lines.push(">");
          const args = tc.function?.arguments || "{}";
          lines.push(`> \`\`\`json`);
          lines.push(`> ${args}`);
          lines.push(`> \`\`\``);
          lines.push("");
        }
      }

      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ═════════════════════════════════════════════════════════════════════════
// Existing API
// ═════════════════════════════════════════════════════════════════════════

/**
 * Inicia el autoguardado periódico.
 */
export function startAutoSave() {
  if (autoSaveTimer) return;
  autoSaveTimer = setInterval(() => {
    if (isDirty) {
      saveSessionSync();
    }
  }, CONFIG.AUTO_SAVE_INTERVAL);
  console.log(`   ⏱  Autoguardado cada ${CONFIG.AUTO_SAVE_INTERVAL / 1000}s activado`);
}

/**
 * Detiene el autoguardado periódico.
 */
export function stopAutoSave() {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
    autoSaveTimer = null;
  }
  // Final save
  saveSessionSync();
}

/**
 * Elimina el archivo de sesión.
 */
export function clearSession() {
  stopAutoSave();
  const stateFile = getStateFilePath();
  if (fs.existsSync(stateFile)) {
    try {
      fs.unlinkSync(stateFile);
    } catch (_) {
      // ignore
    }
  }
  sessionState = {
    sessionId: null,
    startedAt: null,
    lastActivity: null,
    mode: null,
    projectPath: null,
    planStep: 0,
    planTotal: 0,
    planDescription: "",
    messageCount: 0,
    skillsCount: 0,
    toolCallsExecuted: 0,
    messages: [],
  };
}

// ═════════════════════════════════════════════════════════════════════════
// 8.0 — RooState: Crash Recovery Checkpointing
// ═════════════════════════════════════════════════════════════════════════

/**
 * RooState schema (auto-generated, `.lv-zero/roo-state.json`):
 * {
 *   version: 1,
 *   sessionId: string,
 *   lastHeartbeat: ISO timestamp,
 *   status: 'processing' | 'in_progress' | 'complete',
 *   currentTask: string,
 *   currentMode: string,
 *   planFilePath: string,
 *   todoProgress: { total, completed, current },
 *   lastUserMessage: string,
 *   lastAssistantAction: string,
 *   contextFiles: string[],
 *   recentMessages: { role, content, timestamp }[],
 *   keyDecisions: string[]
 * }
 */

/**
 * Guarda el estado activo de Roo para recuperación tras crash.
 * Escribe en .lv-zero/roo-state.json de forma atómica (write + rename).
 * @param {object} state - Parcial del estado de Roo (se mergea con defaults)
 */
export function saveRooState(state) {
  try {
    ensureSessionDir();
    const filePath = getRooStateFilePath();

    // Merge with existing state if present
    let existing = {};
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");
        existing = JSON.parse(raw);
      }
    } catch (_) {
      // If corrupt, start fresh
    }

    const newState = {
      ...existing,
      ...state,
      version: 1,
      sessionId: state.sessionId || existing.sessionId || sessionState.sessionId || null,
      lastHeartbeat: new Date().toISOString(),
    };

    // Atomic write: write to temp file first, then rename
    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(newState, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.warn(`   ⚠️  Error guardando RooState: ${err.message}`);
  }
}

/**
 * Carga el estado guardado de Roo.
 * @returns {object|null} Estado guardado o null si no existe
 */
export function loadRooState() {
  try {
    const filePath = getRooStateFilePath();
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, "utf-8");
    const state = JSON.parse(raw);

    // Validate basic structure
    if (!state || !state.lastHeartbeat) return null;

    return state;
  } catch (err) {
    console.warn(`   ⚠️  Error cargando RooState: ${err.message}`);
    return null;
  }
}

/**
 * Elimina el archivo de RooState.
 * Se llama cuando una tarea se completa exitosamente o el usuario elige empezar fresco.
 */
export function clearRooState() {
  try {
    const filePath = getRooStateFilePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    // Also clean up temp file if any
    const tmpPath = filePath + ".tmp";
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
  } catch (err) {
    console.warn(`   ⚠️  Error limpiando RooState: ${err.message}`);
  }
}

/**
 * Obtiene la ruta del archivo RooState.
 * @returns {string}
 */
export function getRooStatePath() {
  return getRooStateFilePath();
}


export default {
  initSession,
  saveSession,
  saveSessionSync,
  updateState,
  updateStateBatch,
  updatePlanProgress,
  trackMessage,
  trackToolCall,
  setSkillsCount,
  getSessionState,
  getSessionId,
  startAutoSave,
  stopAutoSave,
  clearSession,
  // 7.1 — New exports
  setSessionMetadata,
  saveSessionCheckpoint,
  listSessions,
  exportSession,
  // 7.2 — Session restore
  checkLastSession,
  restoreSession,
  clearLastSession,
  // 7.3 — Auto-checkpoint
  saveAutoCheckpoint,
  // 8.0 — RooState crash recovery
  saveRooState,
  loadRooState,
  clearRooState,
  getRooStatePath,
};
