/**
 * Workflow Triggers — Event-driven workflow suggestion system.
 *
 * Manages a registry of triggers stored in the symphony database's
 * `global_workflow_triggers` table. Each trigger matches a specific
 * event and can optionally filter by content conditions.
 *
 * Built-in triggers (registered on init):
 *   - 'project:opened'       → suggest restore-session workflow
 *   - 'memory:stored:error'  → suggest debug workflow
 *   - 'git:commit'           → suggest review workflow
 *   - 'session:stale'        → suggest cleanup
 *
 * @module core/memory/workflow-triggers
 */

const { MemoryDatabase } = require('./database.cjs');

// ─── Built-in trigger definitions ──────────────────────────────────────────
const BUILT_IN_TRIGGERS = [
  {
    id: 'builtin_project_opened',
    workflow_id: 'restore-session',
    trigger_event: 'project:opened',
    filter_condition: null,
    description: 'Auto-restore session when a project is opened',
    is_builtin: true,
  },
  {
    id: 'builtin_error_debug',
    workflow_id: 'debug',
    trigger_event: 'memory:stored:error',
    filter_condition: null,
    description: 'Suggest debug workflow when an error is stored',
    is_builtin: true,
  },
  {
    id: 'builtin_git_commit_review',
    workflow_id: 'review',
    trigger_event: 'git:commit',
    filter_condition: null,
    description: 'Suggest code review workflow after a commit',
    is_builtin: true,
  },
  {
    id: 'builtin_session_stale_cleanup',
    workflow_id: 'cleanup',
    trigger_event: 'session:stale',
    filter_condition: null,
    description: 'Suggest session cleanup when stale sessions exist',
    is_builtin: true,
  },
];

class WorkflowTriggerManager {
  /**
   * @param {MemoryDatabase} [database] — optional DB for testing/mocking.
   *   If omitted, resolves via MemoryDatabase.getSymphonyInstance().
   * @param {object} [orchestrator] — optional orchestrator reference for
   *   programmatic workflow execution.
   */
  constructor(database, orchestrator) {
    this._db = database || null;
    this._orchestrator = orchestrator || null;
    this._initialized = false;
  }

  /**
   * Get the symphony database instance.
   * @returns {MemoryDatabase}
   */
  _getDB() {
    if (this._db) return this._db;
    return MemoryDatabase.getSymphonyInstance();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Initialize the trigger manager — registers built-in triggers if they
   * don't already exist in the database.
   * @returns {Promise<boolean>}
   */
  async initialize() {
    if (this._initialized) return true;
    const db = this._getDB();

    try {
      for (const trigger of BUILT_IN_TRIGGERS) {
        // Check if already registered
        const existing = db.listAllTriggers().find(t => t.id === trigger.id);
        if (!existing) {
          db.registerTrigger(trigger);
        }
      }
      this._initialized = true;
      console.log('[WorkflowTriggers] Initialized with built-in triggers');
      return true;
    } catch (err) {
      console.error('[WorkflowTriggers] Initialization error:', err.message);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRUD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register a new trigger.
   * @param {object} trigger — { workflow_id, trigger_event, filter_condition?, description? }
   * @returns {object} saved trigger
   */
  register(trigger) {
    const db = this._getDB();
    return db.registerTrigger({
      ...trigger,
      is_builtin: false,
    });
  }

  /**
   * Unregister (delete) a trigger by id.
   * @param {string} id
   * @returns {boolean}
   */
  unregister(id) {
    const db = this._getDB();
    return db.unregisterTrigger(id);
  }

  /**
   * List all registered triggers.
   * @param {boolean} [includeInactive=false]
   * @returns {object[]}
   */
  list(includeInactive = false) {
    const db = this._getDB();
    return includeInactive ? db.listAllTriggers() : db.listGlobalTriggers();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT EVALUATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Evaluate triggers against an event — find matching triggers and optionally
   * execute the associated workflow.
   *
   * @param {string} eventName — e.g., 'memory:stored:error', 'project:opened'
   * @param {object} [eventPayload] — event data for filter evaluation
   * @param {object} [opts]
   * @param {boolean} [opts.execute=false] — if true, execute matched workflows
   * @returns {{ matched: object[], executed: string[] }}
   */
  evaluateEvent(eventName, eventPayload = {}, opts = {}) {
    const execute = opts.execute === true;
    const db = this._getDB();
    const allTriggers = db.listAllTriggers();

    // Find triggers matching the event
    const matched = allTriggers.filter(t => {
      if (t.trigger_event !== eventName) return false;
      if (!t.is_active) return false;

      // Evaluate filter_condition if present (simple JSON matching)
      if (t.filter_condition) {
        try {
          const condition = typeof t.filter_condition === 'string'
            ? JSON.parse(t.filter_condition)
            : t.filter_condition;
          if (!this._matchCondition(condition, eventPayload)) {
            return false;
          }
        } catch {
          // Malformed condition — skip this trigger
          return false;
        }
      }

      return true;
    });

    const executed = [];

    // Optionally execute matched workflows
    if (execute && matched.length > 0 && this._orchestrator) {
      for (const trigger of matched) {
        try {
          if (typeof this._orchestrator.executeWorkflow === 'function') {
            this._orchestrator.executeWorkflow(trigger.workflow_id, {
              triggerId: trigger.id,
              event: eventName,
              payload: eventPayload,
            });
            executed.push(trigger.workflow_id);
          }
        } catch (err) {
          console.error(`[WorkflowTriggers] Failed to execute workflow ${trigger.workflow_id}:`, err.message);
        }
      }
    }

    return { matched, executed };
  }

  /**
   * Simple condition matcher for filter_condition JSON.
   * Supports: { field: 'path', operator: 'contains', value: '/src' }
   * Operators: contains, equals, not_equals, exists
   *
   * @param {object} condition
   * @param {object} payload
   * @returns {boolean}
   */
  _matchCondition(condition, payload) {
    if (!condition || !condition.field) return true;

    const { field, operator, value } = condition;
    const fieldValue = this._getNestedValue(payload, field);

    switch (operator || 'exists') {
      case 'equals':
        return fieldValue === value;
      case 'not_equals':
        return fieldValue !== value;
      case 'contains':
        return String(fieldValue || '').includes(String(value || ''));
      case 'exists':
        return fieldValue !== undefined && fieldValue !== null;
      case 'not_exists':
        return fieldValue === undefined || fieldValue === null;
      case 'greater_than':
        return Number(fieldValue) > Number(value);
      case 'less_than':
        return Number(fieldValue) < Number(value);
      default:
        return true;
    }
  }

  /**
   * Get a nested value from an object using dot notation.
   * @param {object} obj
   * @param {string} path — e.g., 'data.neuronId'
   * @returns {*}
   */
  _getNestedValue(obj, path) {
    if (!obj || !path) return undefined;
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
      if (current === undefined || current === null) return undefined;
      current = current[key];
    }
    return current;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// IPC HANDLER REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register workflow trigger IPC handlers.
 *
 * Channels:
 *   workflow:register-trigger   — register a new trigger
 *   workflow:unregister-trigger — remove a trigger
 *   workflow:list-triggers      — list all triggers
 *   workflow:evaluate-event     — evaluate triggers against an event
 *
 * @param {object} ipcMain
 * @param {WorkflowTriggerManager} triggerManager
 */
function registerWorkflowTriggerIPC(ipcMain, triggerManager) {
  if (!ipcMain || !triggerManager) {
    console.warn('[WorkflowTriggers] Missing ipcMain or triggerManager — skipping');
    return;
  }

  // ── workflow:register-trigger ──────────────────────────────────────────
  ipcMain.handle('workflow:register-trigger', async (_event, payload) => {
    try {
      const { workflow_id, trigger_event, filter_condition, description } = payload || {};
      if (!workflow_id) return { success: false, error: 'workflow_id is required' };
      if (!trigger_event) return { success: false, error: 'trigger_event is required' };
      const trigger = triggerManager.register({
        workflow_id,
        trigger_event,
        filter_condition,
        description,
      });
      return { success: true, trigger };
    } catch (err) {
      console.error('[WorkflowTriggers] workflow:register-trigger error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── workflow:unregister-trigger ────────────────────────────────────────
  ipcMain.handle('workflow:unregister-trigger', async (_event, payload) => {
    try {
      const { id } = payload || {};
      if (!id) return { success: false, error: 'id is required' };
      const result = triggerManager.unregister(id);
      return { success: result };
    } catch (err) {
      console.error('[WorkflowTriggers] workflow:unregister-trigger error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── workflow:list-triggers ─────────────────────────────────────────────
  ipcMain.handle('workflow:list-triggers', async (_event, payload) => {
    try {
      const includeInactive = payload?.includeInactive === true;
      const triggers = triggerManager.list(includeInactive);
      return { success: true, triggers };
    } catch (err) {
      console.error('[WorkflowTriggers] workflow:list-triggers error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── workflow:evaluate-event ────────────────────────────────────────────
  ipcMain.handle('workflow:evaluate-event', async (_event, payload) => {
    try {
      const { event, data, execute } = payload || {};
      if (!event) return { success: false, error: 'event is required' };
      const result = triggerManager.evaluateEvent(event, data || {}, { execute: execute === true });
      return { success: true, ...result };
    } catch (err) {
      console.error('[WorkflowTriggers] workflow:evaluate-event error:', err.message);
      return { success: false, error: err.message };
    }
  });

  console.log('[WorkflowTriggers] Workflow trigger IPC handlers registered');
}

module.exports = { WorkflowTriggerManager, registerWorkflowTriggerIPC, BUILT_IN_TRIGGERS };
