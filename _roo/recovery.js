/**
 * Roo — Standalone Crash Recovery
 *
 * Extracted from lv-zero's orchestrator.js (Phases 1-2 extraction).
 * Designed to run standalone in VS Code context.
 * Detects stale heartbeat > 30s → emits crash signal for Roo to self-recover.
 *
 * v1.0 — June 2025
 */

const { saveRooState, loadRooState, clearRooState } = require("./state_manager.js");

const CRASH_THRESHOLD_MS = 30000; // 30 seconds stale = crash

/**
 * Checks if a previous Roo session crashed.
 * @returns {{ crashed: boolean, state?: object, heartbeatAgeMs?: number, reason?: string }}
 */
function detectCrash() {
  const savedState = loadRooState();
  if (!savedState) {
    return { crashed: false, reason: "No previous state found" };
  }

  const heartbeatAge = Date.now() - new Date(savedState.lastHeartbeat).getTime();

  if (savedState.status === "processing" || savedState.status === "in_progress") {
    if (heartbeatAge > CRASH_THRESHOLD_MS) {
      // Stale heartbeat + active status = crash detected
      return {
        crashed: true,
        state: savedState,
        heartbeatAgeMs: heartbeatAge,
        reason: `Heartbeat ${Math.round(heartbeatAge / 1000)}s stale — crash detected`,
      };
    } else {
      // Heartbeat is recent — clean shutdown
      clearRooState();
      return {
        crashed: false,
        reason: `Clean shutdown (heartbeat: ${Math.round(heartbeatAge / 1000)}s)`,
      };
    }
  }

  if (savedState.status === "complete") {
    // Previous session completed successfully
    clearRooState();
    return { crashed: false, reason: "Previous session completed successfully" };
  }

  return { crashed: false, reason: "Unknown status — no crash assumed" };
}

/**
 * Saves a heartbeat checkpoint.
 * Call this at key points: before tool calls, after responses, at iteration boundaries.
 * @param {object} state - Partial state to save
 */
function heartbeat(state) {
  saveRooState({
    ...state,
    status: "in_progress",
  });
}

/**
 * Marks the current task as complete (clears state).
 */
function complete() {
  clearRooState();
}

module.exports = { detectCrash, heartbeat, complete, saveRooState, loadRooState, clearRooState };
