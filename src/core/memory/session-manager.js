/**
 * Session Manager — 4-phase session restore and persistence.
 *
 * Inspired by Antigravity's session architecture, provides:
 *   Phase 1 — Restore Project Context (git branch, active task)
 *   Phase 2 — Restore Workspace UI (open tabs, panel layout)
 *   Phase 3 — Restore Memory Context (recent decisions, errors, instructions)
 *   Phase 4 — Restore Chat Sessions (session tabs, chat history)
 *
 * All operations are synchronous (backed by better-sqlite3) but wrapped
 * in async methods for IPC compatibility.
 *
 * @module core/memory/session-manager
 */

const { MemoryDatabase } = require('./database.cjs');

class SessionManager {
  /**
   * @param {MemoryDatabase} db — per-project MemoryDatabase instance
   * @param {object} [mainWindow] — Electron BrowserWindow (optional, for push events)
   */
  constructor(db, mainWindow) {
    this._db = db;
    this._mainWindow = mainWindow;
  }

  /**
   * Get the underlying MemoryDatabase instance.
   * @returns {MemoryDatabase}
   */
  get db() {
    return this._db;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FULL 4-PHASE RESTORE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Full 4-phase session restore — called on startup and project switch.
   * @param {string} projectPath
   * @returns {object}
   */
  restoreFullSession(projectPath) {
    return {
      project: this.restoreProjectContext(projectPath),
      workspace: this.restoreWorkspaceUI(projectPath),
      memory: this.restoreMemoryContext(projectPath),
      chat: this.restoreChatSessions(projectPath),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1 — PROJECT CONTEXT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Restore project context: git branch/commit, active task.
   * @param {string} projectPath
   * @returns {object}
   */
  restoreProjectContext(projectPath) {
    const db = this._getDB(projectPath);

    // Find the most recent session for this project
    const sessions = db.listSessions(projectPath, 1);
    const lastSession = sessions[0] || {};

    // Find the most recent active task
    const tasks = db._db.prepare(
      'SELECT * FROM tasks WHERE project_path = ? ORDER BY created_at DESC LIMIT 1'
    ).all(projectPath);

    return {
      path: projectPath,
      gitBranch: lastSession.git_branch || null,
      gitCommit: lastSession.git_commit_hash || null,
      activeTask: tasks[0] || null,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2 — WORKSPACE UI
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Restore workspace UI state: open tabs, active tab, panel layout.
   * @param {string} projectPath
   * @returns {object}
   */
  restoreWorkspaceUI(projectPath) {
    const db = this._getDB(projectPath);
    const sessions = db.listSessions(projectPath, 1);
    const lastSession = sessions[0] || {};

    let openTabs = [];
    let activeTab = null;
    let panelLayout = {};

    try {
      openTabs = JSON.parse(lastSession.open_tabs || '[]');
    } catch { /* ignore parse errors */ }

    try {
      panelLayout = JSON.parse(lastSession.panel_layout || '{}');
    } catch { /* ignore parse errors */ }

    activeTab = lastSession.active_tab || null;

    return { openTabs, activeTab, panelLayout };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3 — MEMORY CONTEXT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Restore memory context: recent decisions, errors, and active instructions.
   * @param {string} projectPath
   * @returns {object}
   */
  restoreMemoryContext(projectPath) {
    const db = this._getDB(projectPath);

    const recentDecisions = db.searchNeurons({
      type: 'decision',
      projectPath,
      limit: 5,
      activeOnly: true,
    });

    const recentErrors = db.searchNeurons({
      type: 'error',
      projectPath,
      limit: 5,
      activeOnly: true,
    });

    const activeInstructions = db.searchNeurons({
      type: 'instruction',
      projectPath,
      limit: 10,
      activeOnly: true,
    });

    return {
      recentDecisions: recentDecisions.neurons,
      recentErrors: recentErrors.neurons,
      activeInstructions: activeInstructions.neurons,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 4 — CHAT SESSIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Restore chat sessions: list all sessions, identify active one.
   * @param {string} projectPath
   * @returns {object}
   */
  restoreChatSessions(projectPath) {
    const db = this._getDB(projectPath);
    const sessions = db.listSessions(projectPath);
    const activeSession = sessions.length > 0 ? sessions[0] : null;

    return {
      sessions,
      activeSessionId: activeSession ? activeSession.id : null,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAVE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Save or update a session state.
   * @param {string} projectPath
   * @param {object} state — session fields (id, name, mode, openTabs, etc.)
   * @returns {object} saved session
   */
  saveSessionState(projectPath, state) {
    const db = this._getDB(projectPath);
    return db.saveSession({
      ...state,
      project_path: projectPath,
    });
  }

  /**
   * Save workspace state (tabs, layout) to the most recent session.
   * @param {string} projectPath
   * @param {object} workspaceData — { openTabs, activeTab, panelLayout }
   * @returns {boolean}
   */
  saveWorkspaceState(projectPath, workspaceData) {
    const db = this._getDB(projectPath);
    const sessions = db.listSessions(projectPath, 1);
    if (sessions.length === 0) return false;

    const session = sessions[0];
    db.saveSession({
      ...session,
      open_tabs: JSON.stringify(workspaceData.openTabs || []),
      active_tab: workspaceData.activeTab || null,
      panel_layout: JSON.stringify(workspaceData.panelLayout || {}),
    });
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNAL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve the MemoryDatabase for a given project path.
   * Uses the instance's own DB if it matches, or creates a new one.
   * @param {string} projectPath
   * @returns {MemoryDatabase}
   */
  _getDB(projectPath) {
    if (this._db && !this._db._isSymphony) {
      // Check if the existing DB matches this project path
      if (this._db._projectPath === projectPath) {
        return this._db;
      }
    }
    // Fallback: get or create the instance for this project
    return MemoryDatabase.getInstance(projectPath);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// IPC HANDLER REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register all session IPC handlers on the given ipcMain.
 * @param {object} ipcMain
 * @param {SessionManager} sessionManager
 */
function registerSessionIPC(ipcMain, sessionManager) {
  if (!ipcMain || !sessionManager) {
    console.warn('[SessionIPC] Missing ipcMain or sessionManager — skipping');
    return;
  }

  // ── session:restore-full ─────────────────────────────────────────────────
  ipcMain.handle('session:restore-full', async (_event, payload) => {
    try {
      const { projectPath } = payload;
      if (!projectPath) return { success: false, error: 'projectPath is required' };
      const fullState = sessionManager.restoreFullSession(projectPath);
      return { success: true, fullState };
    } catch (err) {
      console.error('[SessionIPC] session:restore-full error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── session:save ─────────────────────────────────────────────────────────
  ipcMain.handle('session:save', async (_event, payload) => {
    try {
      const { projectPath, ...state } = payload;
      if (!projectPath) return { success: false, error: 'projectPath is required' };
      const saved = sessionManager.saveSessionState(projectPath, state);
      return { success: true, id: saved.id };
    } catch (err) {
      console.error('[SessionIPC] session:save error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── session:load ─────────────────────────────────────────────────────────
  ipcMain.handle('session:load', async (_event, payload) => {
    try {
      const { id, projectPath } = payload;
      if (!id) return { success: false, error: 'id is required' };
      if (!projectPath) return { success: false, error: 'projectPath is required' };
      const db = MemoryDatabase.getInstance(projectPath);
      const session = db.loadSession(id);
      return { success: true, session };
    } catch (err) {
      console.error('[SessionIPC] session:load error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── session:list ─────────────────────────────────────────────────────────
  ipcMain.handle('session:list', async (_event, payload) => {
    try {
      const { projectPath } = payload || {};
      if (!projectPath) return { success: false, error: 'projectPath is required' };
      const db = MemoryDatabase.getInstance(projectPath);
      const sessions = db.listSessions(projectPath);
      return { success: true, sessions };
    } catch (err) {
      console.error('[SessionIPC] session:list error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── session:delete ───────────────────────────────────────────────────────
  ipcMain.handle('session:delete', async (_event, payload) => {
    try {
      const { id, projectPath } = payload;
      if (!id) return { success: false, error: 'id is required' };
      if (!projectPath) return { success: false, error: 'projectPath is required' };
      const db = MemoryDatabase.getInstance(projectPath);
      const deleted = db.deleteSession(id);
      return { success: deleted };
    } catch (err) {
      console.error('[SessionIPC] session:delete error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── session:save-workspace ───────────────────────────────────────────────
  ipcMain.handle('session:save-workspace', async (_event, payload) => {
    try {
      const { projectPath, workspace } = payload;
      if (!projectPath) return { success: false, error: 'projectPath is required' };
      const result = sessionManager.saveWorkspaceState(projectPath, workspace || {});
      return { success: result };
    } catch (err) {
      console.error('[SessionIPC] session:save-workspace error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── session:save-task ────────────────────────────────────────────────────
  ipcMain.handle('session:save-task', async (_event, payload) => {
    try {
      const { projectPath, ...task } = payload;
      if (!projectPath) return { success: false, error: 'projectPath is required' };
      const db = MemoryDatabase.getInstance(projectPath);
      const saved = db.storeTask({ ...task, project_path: projectPath });
      return { success: true, id: saved.id };
    } catch (err) {
      console.error('[SessionIPC] session:save-task error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── session:list-tasks ───────────────────────────────────────────────────
  ipcMain.handle('session:list-tasks', async (_event, payload) => {
    try {
      const { projectPath, status } = payload || {};
      if (!projectPath) return { success: false, error: 'projectPath is required' };
      const db = MemoryDatabase.getInstance(projectPath);
      const tasks = db.listTasks({ status, projectPath });
      return { success: true, tasks };
    } catch (err) {
      console.error('[SessionIPC] session:list-tasks error:', err.message);
      return { success: false, error: err.message };
    }
  });

  console.log('[SessionIPC] Session IPC handlers registered');
}

module.exports = { SessionManager, registerSessionIPC };
