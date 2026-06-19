/**
 * Preflight Gate — Single health/project/task aggregation endpoint.
 *
 * Provides a comprehensive snapshot of the application state in one call,
 * aggregating data from:
 *   - MemoryDatabase (neuron stats, tasks)
 *   - SessionManager  (session state, project context)
 *   - Orchestrator    (optional, for mode/status/uptime)
 *
 * Also exposes a lightweight `ping()` for quick health checks.
 *
 * @module core/memory/preflight-gate
 */

const { MemoryDatabase } = require('./database.cjs');

class PreflightGate {
  /**
   * @param {MemoryDatabase} [database] — optional DB for testing/mocking
   * @param {object} [sessionManager] — optional SessionManager instance
   * @param {object} [orchestrator] — optional orchestrator reference for status/mode/uptime
   */
  constructor(database, sessionManager, orchestrator) {
    this._db = database || null;
    this._sessionManager = sessionManager || null;
    this._orchestrator = orchestrator || null;
    this._startTime = Date.now();
  }

  /**
   * Resolve a MemoryDatabase for the given project path.
   * @param {string} projectPath
   * @returns {MemoryDatabase}
   */
  _getDB(projectPath) {
    if (this._db) return this._db;
    return MemoryDatabase.getInstance(projectPath);
  }

  /**
   * Get orchestrator status if available.
   * @returns {object}
   */
  _getOrchestratorStatus() {
    const orch = this._orchestrator;
    if (!orch) {
      return { status: 'unavailable', mode: null, uptime: null };
    }
    return {
      status: orch.ready ? 'ready' : 'starting',
      mode: orch.mode || orch.currentMode || null,
      uptime: Math.floor((Date.now() - (orch._startTime || this._startTime)) / 1000),
    };
  }

  /**
   * Get git status via a lightweight shell check.
   * Returns 'clean', 'dirty', or 'unknown' if git is not available.
   * @param {string} projectPath
   * @returns {string}
   */
  _getGitStatus(projectPath) {
    try {
      const { execSync } = require('child_process');
      const result = execSync('git status --porcelain', {
        cwd: projectPath,
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return result.trim().length > 0 ? 'dirty' : 'clean';
    } catch {
      return 'unknown';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PREFLIGHT CHECK
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Comprehensive preflight check — returns everything in one call.
   *
   * @param {string} projectPath
   * @returns {Promise<object>}
   */
  async check(projectPath) {
    const db = projectPath ? this._getDB(projectPath) : null;
    const sm = this._sessionManager;

    // ── Project section ──────────────────────────────────────────────────
    let project = {
      isOpen: !!projectPath,
      path: projectPath || null,
      gitBranch: null,
      gitStatus: 'unknown',
      gitCommitCount: 0,
    };

    if (projectPath) {
      // Get git branch/commit from session manager or fallback
      if (sm && typeof sm.restoreProjectContext === 'function') {
        try {
          const ctx = sm.restoreProjectContext(projectPath);
          project.gitBranch = ctx.gitBranch || null;
          project.gitCommit = ctx.gitCommit || null;
        } catch { /* ignore */ }
      }
      project.gitStatus = this._getGitStatus(projectPath);
    }

    // ── Memory section ───────────────────────────────────────────────────
    let memory = {
      totalNeurons: 0,
      activeNeurons: 0,
      expiredNeurons: 0,
      recentMemories: [],
    };

    if (db) {
      try {
        const stats = db.getMemoryStats(projectPath);
        memory.totalNeurons = stats.totalNeurons || 0;
        memory.activeNeurons = stats.activeNeurons || 0;
        memory.expiredNeurons = stats.expiredNeurons || 0;

        // Fetch 5 most recent active neurons
        const recent = db.searchNeurons({
          projectPath,
          activeOnly: true,
          limit: 5,
        });
        memory.recentMemories = (recent.neurons || []).map(n => ({
          id: n.id,
          type: n.type,
          content: (n.content || '').substring(0, 120),
          priority: n.priority,
          lastAccessedAt: n.last_accessed_at,
        }));
      } catch { /* ignore */ }
    }

    // ── Session section ──────────────────────────────────────────────────
    let session = {
      activeSessionId: null,
      sessionCount: 0,
      lastActivity: null,
    };

    if (sm && projectPath) {
      try {
        if (typeof sm.restoreChatSessions === 'function') {
          const chat = sm.restoreChatSessions(projectPath);
          session.activeSessionId = chat.activeSessionId || null;
          session.sessionCount = (chat.sessions || []).length;
          if (chat.sessions && chat.sessions.length > 0) {
            session.lastActivity = chat.sessions[0].last_activity_at
              ? new Date(chat.sessions[0].last_activity_at * 1000).toISOString()
              : null;
          }
        }
      } catch { /* ignore */ }
    }

    // ── Tasks section ────────────────────────────────────────────────────
    let tasks = {
      active: null,
      pending: [],
      completedToday: 0,
    };

    if (db && projectPath) {
      try {
        // Get most recent active task
        const activeTasks = db.listTasks({ status: 'active', projectPath });
        tasks.active = activeTasks.length > 0 ? {
          id: activeTasks[0].id,
          description: (activeTasks[0].description || '').substring(0, 200),
          priority: activeTasks[0].priority,
          createdAt: activeTasks[0].created_at,
        } : null;

        // Get pending tasks
        const pendingTasks = db.listTasks({ status: 'pending', projectPath });
        tasks.pending = pendingTasks.slice(0, 5).map(t => ({
          id: t.id,
          description: (t.description || '').substring(0, 200),
          createdAt: t.created_at,
        }));

        // Count tasks completed today
        const todayStart = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
        const allTasks = db.listTasks({ projectPath });
        tasks.completedToday = allTasks.filter(
          t => t.status === 'completed' && t.completed_at >= todayStart
        ).length;
      } catch { /* ignore */ }
    }

    // ── Orchestrator section ─────────────────────────────────────────────
    const orchestrator = this._getOrchestratorStatus();

    // ── Assemble result ──────────────────────────────────────────────────
    const healthy = !!(db || projectPath);

    return {
      healthy,
      timestamp: new Date().toISOString(),
      project,
      memory,
      session,
      tasks,
      orchestrator,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Quick health check — always succeeds as long as the module is loaded.
   * @returns {object}
   */
  ping() {
    return {
      status: 'ok',
      uptime: Math.floor((Date.now() - this._startTime) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// IPC HANDLER REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register preflight gate IPC handlers.
 *
 * Channels:
 *   memory:preflight — comprehensive health/project/task check
 *   memory:ping      — lightweight ping
 *
 * @param {object} ipcMain
 * @param {PreflightGate} preflightGate
 */
function registerPreflightGateIPC(ipcMain, preflightGate) {
  if (!ipcMain || !preflightGate) {
    console.warn('[PreflightGate] Missing ipcMain or preflightGate — skipping');
    return;
  }

  // ── memory:preflight ────────────────────────────────────────────────────
  ipcMain.handle('memory:preflight', async (_event, payload) => {
    try {
      const { projectPath } = payload || {};
      const result = await preflightGate.check(projectPath || null);
      return { success: true, preflight: result };
    } catch (err) {
      console.error('[PreflightGate] memory:preflight error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── memory:ping ─────────────────────────────────────────────────────────
  ipcMain.handle('memory:ping', async () => {
    try {
      return { success: true, ping: preflightGate.ping() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  console.log('[PreflightGate] Preflight gate IPC handlers registered');
}

module.exports = { PreflightGate, registerPreflightGateIPC };
