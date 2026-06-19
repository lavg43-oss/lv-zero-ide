/**
 * Roo — Standalone State Manager (Crash Recovery)
 *
 * Extracted from lv-zero's state_manager.js (Phases 1-2 extraction).
 * Runs standalone in VS Code context, NOT inside lv-zero Electron app.
 * Writes to `.lv-zero/roo-state.json` for crash recovery tracking.
 *
 * v1.0 — June 2025
 */

const fs = require("fs");
const path = require("path");

// ─── Configuration ──────────────────────────────────────────────────────────
const SESSION_DIR = path.resolve(__dirname, "..", ".lv-zero");
const ROO_STATE_FILE = "roo-state.json";

// ─── Helpers ────────────────────────────────────────────────────────────────

function ensureSessionDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

function getRooStateFilePath() {
  return path.join(SESSION_DIR, ROO_STATE_FILE);
}

/**
 * Roo state schema (auto-generated, `.lv-zero/roo-state.json`):
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
function saveRooState(state) {
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
      sessionId: state.sessionId || existing.sessionId || null,
      lastHeartbeat: new Date().toISOString(),
    };

    // Atomic write: write to temp file first, then rename
    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(newState, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.warn(`   ⚠️  Error guardando estado de Roo: ${err.message}`);
  }
}

/**
 * Carga el estado guardado de Roo.
 * @returns {object|null} Estado guardado o null si no existe
 */
function loadRooState() {
  try {
    const filePath = getRooStateFilePath();
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, "utf-8");
    const state = JSON.parse(raw);

    // Validate basic structure
    if (!state || !state.lastHeartbeat) return null;

    return state;
  } catch (err) {
    console.warn(`   ⚠️  Error cargando estado de Roo: ${err.message}`);
    return null;
  }
}

/**
 * Elimina el archivo de estado de Roo.
 * Se llama cuando una tarea se completa exitosamente o el usuario elige empezar fresco.
 */
function clearRooState() {
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
    console.warn(`   ⚠️  Error limpiando estado de Roo: ${err.message}`);
  }
}

module.exports = { saveRooState, loadRooState, clearRooState };
