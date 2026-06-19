/**
 * Memory Database — SQLite wrapper for per-project and cross-project persistence.
 *
 * Provides:
 *   - Schema creation and migration
 *   - Connection management (one per project + one symphony cross-project)
 *   - Full CRUD for neurons, synapses, tasks, sessions, audit_log
 *   - Cross-project memory sharing
 *   - Global workflow triggers
 *   - Local vector store fallback (when Supabase is unavailable)
 *
 * All methods are synchronous (better-sqlite3 is sync by design).
 * Use worker threads or debounced batching for heavy operations.
 *
 * @module core/memory/database
 */

const path = require('path');
const crypto = require('crypto');

// Safe electron import — works outside Electron runtime (e.g., tests)
let app;
try {
  app = require('electron').app;
} catch {
  app = { getPath: () => path.join(process.cwd(), '.lv-zero-data') };
}

let Database;

// Lazy-load better-sqlite3 — it's a native module that may fail to load
try {
  Database = require('better-sqlite3');
} catch (err) {
  console.warn('[MemoryDB] better-sqlite3 not available:', err.message);
  Database = null;
}

// Local vector store fallback (Phase 4 — RAG & Memory Enhancement)
const { LocalVectorStore } = require('./local_vector.js');

// ── Schema Definitions ───────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;

const MEMORY_DB_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS neurons (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('fact','decision','error','instruction','workflow','preference','context')),
    content TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    priority REAL DEFAULT 0.5 CHECK(priority >= 0 AND priority <= 1),
    ttl_seconds INTEGER,
    created_at INTEGER NOT NULL,
    last_accessed_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
    access_count INTEGER DEFAULT 0,
    source TEXT DEFAULT 'agent',
    project_path TEXT NOT NULL,
    is_active INTEGER DEFAULT 1
  )`,

  `CREATE INDEX IF NOT EXISTS idx_neurons_type ON neurons(type)`,
  `CREATE INDEX IF NOT EXISTS idx_neurons_priority ON neurons(priority DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_neurons_project ON neurons(project_path)`,
  `CREATE INDEX IF NOT EXISTS idx_neurons_active ON neurons(is_active) WHERE is_active = 1`,

  `CREATE TABLE IF NOT EXISTS synapses (
    id TEXT PRIMARY KEY,
    source_neuron_id TEXT NOT NULL REFERENCES neurons(id) ON DELETE CASCADE,
    target_neuron_id TEXT NOT NULL REFERENCES neurons(id) ON DELETE CASCADE,
    weight REAL DEFAULT 0.5 CHECK(weight >= 0 AND weight <= 1),
    relationship_type TEXT,
    created_at INTEGER NOT NULL,
    last_activated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
    activation_count INTEGER DEFAULT 0,
    UNIQUE(source_neuron_id, target_neuron_id, relationship_type)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_synapses_source ON synapses(source_neuron_id)`,
  `CREATE INDEX IF NOT EXISTS idx_synapses_target ON synapses(target_neuron_id)`,
  `CREATE INDEX IF NOT EXISTS idx_synapses_weight ON synapses(weight DESC)`,

  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    description TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','failed','cancelled')),
    priority INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    project_path TEXT NOT NULL,
    mode_used TEXT,
    result_summary TEXT,
    related_memories TEXT DEFAULT '[]'
  )`,

  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_path)`,

  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    name TEXT,
    created_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL,
    mode TEXT,
    git_branch TEXT,
    git_commit_hash TEXT,
    active_task_id TEXT REFERENCES tasks(id),
    open_tabs TEXT DEFAULT '[]',
    active_tab TEXT,
    panel_layout TEXT DEFAULT '{}',
    chat_summary TEXT,
    metadata TEXT DEFAULT '{}'
  )`,

  `CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path)`,

  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at INTEGER NOT NULL,
    dimension TEXT NOT NULL,
    score REAL NOT NULL CHECK(score >= 0 AND score <= 1),
    details TEXT DEFAULT '{}',
    project_path TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_path)`,
];

const SYMPHONY_DB_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS cross_project_memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    priority REAL DEFAULT 0.5,
    source_project TEXT,
    target_projects TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL,
    last_shared_at INTEGER,
    share_count INTEGER DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS global_workflow_triggers (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    trigger_event TEXT NOT NULL,
    filter_condition TEXT,
    created_at INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1,
    description TEXT
  )`,
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId() {
  return 'mem_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

function generateSynapseId() {
  return 'syn_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

function generateTaskId() {
  return 'task_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

function generateTriggerId() {
  return 'trg_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

function getWorkspaceId(projectPath) {
  return crypto.createHash('md5').update(projectPath.toLowerCase()).digest('hex');
}

function getUserDataPath() {
  try {
    return app.getPath('userData');
  } catch {
    return path.join(process.cwd(), '.lv-zero-data');
  }
}

function getMemoryDbPath(projectPath) {
  const workspaceId = getWorkspaceId(projectPath);
  const dir = path.join(getUserDataPath(), 'projects', workspaceId);
  return { dir, file: path.join(dir, 'memory.db') };
}

function getSymphonyDbPath() {
  const dir = getUserDataPath();
  return { dir, file: path.join(dir, 'symphony.db') };
}

function initSchema(db, statements) {
  // First, ensure the schema_version table exists (it's not in the schema list)
  try {
    db.prepare(`CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )`).run();
  } catch (_) {
    // Table may already exist
  }

  const versionRow = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get();
  const currentVersion = versionRow ? versionRow.version : 0;

  if (currentVersion >= SCHEMA_VERSION) {
    return; // Schema is up-to-date
  }

  // Run all DDL statements in a transaction
  const runMigration = db.transaction(() => {
    for (const stmt of statements) {
      db.prepare(stmt).run();
    }
    db.prepare('INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      SCHEMA_VERSION,
      Math.floor(Date.now() / 1000)
    );
  });

  runMigration();
  console.log(`[MemoryDB] Schema migrated to version ${SCHEMA_VERSION}`);
}

// ── MemoryDatabase Class ─────────────────────────────────────────────────────

class MemoryDatabase {
  /**
   * Map of projectPath → MemoryDatabase instance
   * @type {Map<string, MemoryDatabase>}
   */
  static _instances = new Map();

  /** @type {MemoryDatabase|null} */
  static _symphonyInstance = null;

  /**
   * Get or create a per-project MemoryDatabase instance.
   * @param {string} projectPath
   * @returns {MemoryDatabase}
   */
  static getInstance(projectPath) {
    if (!projectPath) {
      throw new Error('[MemoryDB] projectPath is required');
    }

    // Normalize path separators
    const normalized = path.resolve(projectPath);

    if (MemoryDatabase._instances.has(normalized)) {
      return MemoryDatabase._instances.get(normalized);
    }

    const instance = new MemoryDatabase(normalized);
    MemoryDatabase._instances.set(normalized, instance);
    return instance;
  }

  /**
   * Get or create the cross-project symphony database instance.
   * @returns {MemoryDatabase}
   */
  static getSymphonyInstance() {
    if (MemoryDatabase._symphonyInstance) {
      return MemoryDatabase._symphonyInstance;
    }

    const instance = new MemoryDatabase(null, true);
    MemoryDatabase._symphonyInstance = instance;
    return instance;
  }

  /**
   * Close all database instances (call on app shutdown).
   */
  static closeAll() {
    for (const instance of MemoryDatabase._instances.values()) {
      instance.close();
    }
    MemoryDatabase._instances.clear();

    if (MemoryDatabase._symphonyInstance) {
      MemoryDatabase._symphonyInstance.close();
      MemoryDatabase._symphonyInstance = null;
    }
  }

  /**
   * @param {string|null} projectPath
   * @param {boolean} isSymphony
   */
  constructor(projectPath, isSymphony = false) {
    if (!Database) {
      throw new Error('[MemoryDB] better-sqlite3 is not available. Cannot create database.');
    }

    this._isSymphony = isSymphony;
    this._projectPath = projectPath;

    let dbPath;
    if (isSymphony) {
      const { dir, file } = getSymphonyDbPath();
      this._ensureDir(dir);
      dbPath = file;
    } else {
      const { dir, file } = getMemoryDbPath(projectPath);
      this._ensureDir(dir);
      dbPath = file;
    }

    this._dbPath = dbPath;
    this._db = new Database(dbPath);

    // Enable WAL mode for better concurrent performance
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');

    // Initialize schema
    const schema = isSymphony ? SYMPHONY_DB_SCHEMA : MEMORY_DB_SCHEMA;
    initSchema(this._db, schema);

    // Prepare common statements for performance
    this._prepStmts = {};
    this._prepareStatements();

    // ── Vector Store (Phase 4 — RAG & Memory Enhancement) ──────────────
    /** @type {boolean} Whether Supabase is available for vector storage */
    this._supabaseAvailable = false;
    /** @type {LocalVectorStore|null} Local fallback vector store */
    this._localVectorStore = null;

    // Auto-detect Supabase availability
    this._detectVectorBackend();

    console.log(`[MemoryDB] ${isSymphony ? 'Symphony' : 'Project'} database opened: ${dbPath}`);
  }

  /**
   * Auto-detect whether Supabase is available for vector storage.
   * If not, initialize the local vector store as fallback.
   */
  _detectVectorBackend() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseKey) {
      // Supabase credentials are configured — try to connect
      try {
        // We don't actually create the Supabase client here (it's async),
        // but we mark it as potentially available. The caller will handle
        // the actual Supabase connection and fall back if it fails.
        this._supabaseAvailable = true;
        console.log('[MemoryDB] Supabase credentials detected — vector store will use Supabase when available.');
      } catch {
        this._supabaseAvailable = false;
      }
    }

    if (!this._supabaseAvailable) {
      // Initialize local vector store as fallback
      try {
        const vectorDbPath = this._dbPath.replace('.db', '_vectors.db');
        this._localVectorStore = new LocalVectorStore(vectorDbPath, {
          maxResults: 10,
        });
        console.log('[MemoryDB] Local vector store initialized as fallback.');
      } catch (err) {
        console.warn('[MemoryDB] Failed to initialize local vector store:', err.message);
      }
    }
  }

  /**
   * Ensure a directory exists.
   * @param {string} dir
   */
  _ensureDir(dir) {
    const fs = require('fs');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Precompile frequently used SQL statements.
   */
  _prepareStatements() {
    if (this._isSymphony) return; // Simpler schema, prepare on the fly

    const db = this._db;

    // Neuron statements
    this._prepStmts.storeNeuron = db.prepare(`
      INSERT OR REPLACE INTO neurons (id, type, content, metadata, priority, ttl_seconds, created_at, last_accessed_at, access_count, source, project_path, is_active)
      VALUES (@id, @type, @content, @metadata, @priority, @ttl_seconds, @created_at, @last_accessed_at, @access_count, @source, @project_path, @is_active)
    `);

    this._prepStmts.getNeuron = db.prepare('SELECT * FROM neurons WHERE id = ?');

    this._prepStmts.deleteNeuron = db.prepare('DELETE FROM neurons WHERE id = ?');

    this._prepStmts.updateNeuronAccess = db.prepare(`
      UPDATE neurons SET last_accessed_at = CAST(strftime('%s','now') AS INTEGER), access_count = access_count + 1 WHERE id = ?
    `);

    this._prepStmts.deactivateExpired = db.prepare(`
      UPDATE neurons SET is_active = 0
      WHERE is_active = 1 AND ttl_seconds IS NOT NULL
      AND (created_at + ttl_seconds) < CAST(strftime('%s','now') AS INTEGER)
    `);

    this._prepStmts.getExpiredNeurons = db.prepare(`
      SELECT * FROM neurons
      WHERE is_active = 1 AND ttl_seconds IS NOT NULL
      AND (created_at + ttl_seconds) < CAST(strftime('%s','now') AS INTEGER)
    `);

    // Synapse statements
    this._prepStmts.createSynapse = db.prepare(`
      INSERT OR REPLACE INTO synapses (id, source_neuron_id, target_neuron_id, weight, relationship_type, created_at, last_activated_at, activation_count)
      VALUES (@id, @source_neuron_id, @target_neuron_id, @weight, @relationship_type, @created_at, @last_activated_at, @activation_count)
    `);

    this._prepStmts.getSynapsesForNeuron = db.prepare(`
      SELECT * FROM synapses WHERE source_neuron_id = ? OR target_neuron_id = ?
    `);

    this._prepStmts.getOutgoingSynapses = db.prepare('SELECT * FROM synapses WHERE source_neuron_id = ?');
    this._prepStmts.getIncomingSynapses = db.prepare('SELECT * FROM synapses WHERE target_neuron_id = ?');

    this._prepStmts.deleteSynapse = db.prepare('DELETE FROM synapses WHERE id = ?');

    this._prepStmts.updateSynapseActivation = db.prepare(`
      UPDATE synapses SET last_activated_at = CAST(strftime('%s','now') AS INTEGER), activation_count = activation_count + 1 WHERE id = ?
    `);

    // Task statements
    this._prepStmts.storeTask = db.prepare(`
      INSERT OR REPLACE INTO tasks (id, session_id, description, status, priority, created_at, completed_at, project_path, mode_used, result_summary, related_memories)
      VALUES (@id, @session_id, @description, @status, @priority, @created_at, @completed_at, @project_path, @mode_used, @result_summary, @related_memories)
    `);

    this._prepStmts.getTask = db.prepare('SELECT * FROM tasks WHERE id = ?');
    this._prepStmts.updateTaskStatus = db.prepare('UPDATE tasks SET status = ?, completed_at = ?, result_summary = ? WHERE id = ?');

    // Session statements
    this._prepStmts.saveSession = db.prepare(`
      INSERT OR REPLACE INTO sessions (id, project_path, name, created_at, last_activity_at, mode, git_branch, git_commit_hash, active_task_id, open_tabs, active_tab, panel_layout, chat_summary, metadata)
      VALUES (@id, @project_path, @name, @created_at, @last_activity_at, @mode, @git_branch, @git_commit_hash, @active_task_id, @open_tabs, @active_tab, @panel_layout, @chat_summary, @metadata)
    `);

    this._prepStmts.loadSession = db.prepare('SELECT * FROM sessions WHERE id = ?');
    this._prepStmts.deleteSession = db.prepare('DELETE FROM sessions WHERE id = ?');

    // Audit statements
    this._prepStmts.logAudit = db.prepare(`
      INSERT INTO audit_log (run_at, dimension, score, details, project_path)
      VALUES (?, ?, ?, ?, ?)
    `);
  }

  /**
   * Close the database connection and clean up the local vector store.
   */
  close() {
    if (this._db && this._db.open) {
      this._db.close();
      console.log(`[MemoryDB] Database closed: ${this._dbPath}`);
    }

    // Close local vector store if initialized
    if (this._localVectorStore) {
      try {
        this._localVectorStore.close();
      } catch (err) {
        console.warn('[MemoryDB] Error closing local vector store:', err.message);
      }
      this._localVectorStore = null;
    }
  }

  /**
   * Get the raw better-sqlite3 Database instance (for advanced operations).
   * @returns {object}
   */
  get raw() {
    return this._db;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NEURON OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Store a neuron (memory entry). If `id` is provided and exists, it updates.
   * @param {object} neuron
   * @param {string} [neuron.id] — auto-generated if omitted
   * @param {string} neuron.type — one of: fact, decision, error, instruction, workflow, preference, context
   * @param {string} neuron.content
   * @param {object} [neuron.metadata]
   * @param {number} [neuron.priority=0.5]
   * @param {number} [neuron.ttl_seconds] — time-to-live in seconds, null = never expires
   * @param {string} [neuron.source='agent']
   * @param {string} [neuron.project_path]
   * @returns {object} stored neuron
   */
  storeNeuron(neuron) {
    const now = Math.floor(Date.now() / 1000);
    const id = neuron.id || generateId();

    const data = {
      id,
      type: neuron.type,
      content: neuron.content,
      metadata: JSON.stringify(neuron.metadata || {}),
      priority: neuron.priority ?? 0.5,
      ttl_seconds: neuron.ttl_seconds ?? null,
      created_at: neuron.created_at || now,
      last_accessed_at: now,
      access_count: neuron.access_count || 0,
      source: neuron.source || 'agent',
      project_path: neuron.project_path || this._projectPath || '',
      is_active: neuron.is_active !== undefined ? (neuron.is_active ? 1 : 0) : 1,
    };

    this._prepStmts.storeNeuron.run(data);
    return this._prepStmts.getNeuron.get(id);
  }

  /**
   * Get a neuron by ID.
   * @param {string} id
   * @returns {object|null}
   */
  getNeuron(id) {
    return this._prepStmts.getNeuron.get(id) || null;
  }

  /**
   * Search neurons with filtering and pagination.
   * @param {object} opts
   * @param {string} [opts.type] — filter by type
   * @param {string} [opts.query] — text search in content
   * @param {number} [opts.minPriority] — minimum priority filter
   * @param {number} [opts.limit=50]
   * @param {number} [opts.offset=0]
   * @param {boolean} [opts.activeOnly=true]
   * @param {string} [opts.projectPath]
   * @returns {{ neurons: object[], total: number }}
   */
  searchNeurons(opts = {}) {
    const conditions = [];
    const params = [];

    if (opts.activeOnly !== false) {
      conditions.push('is_active = 1');
    }

    if (opts.type) {
      conditions.push('type = ?');
      params.push(opts.type);
    }

    if (opts.query) {
      conditions.push('content LIKE ?');
      params.push(`%${opts.query}%`);
    }

    if (opts.minPriority !== undefined) {
      conditions.push('priority >= ?');
      params.push(opts.minPriority);
    }

    if (opts.projectPath) {
      conditions.push('project_path = ?');
      params.push(opts.projectPath);
    } else if (this._projectPath && !this._isSymphony) {
      conditions.push('project_path = ?');
      params.push(this._projectPath);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const limit = opts.limit || 50;
    const offset = opts.offset || 0;

    const countRow = this._db.prepare(`SELECT COUNT(*) as total FROM neurons ${where}`).get(...params);
    const rows = this._db.prepare(`SELECT * FROM neurons ${where} ORDER BY priority DESC, last_accessed_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

    return { neurons: rows, total: countRow.total };
  }

  /**
   * List neurons by type.
   * @param {string} type
   * @param {object} [opts]
   * @returns {{ neurons: object[], total: number }}
   */
  listNeuronsByType(type, opts = {}) {
    return this.searchNeurons({ ...opts, type });
  }

  /**
   * Delete a neuron by ID (cascades to synapses).
   * @param {string} id
   * @returns {boolean}
   */
  deleteNeuron(id) {
    const result = this._prepStmts.deleteNeuron.run(id);
    return result.changes > 0;
  }

  /**
   * Update access metadata for a neuron.
   * @param {string} id
   */
  touchNeuron(id) {
    this._prepStmts.updateNeuronAccess.run(id);
  }

  /**
   * Deactivate all expired neurons (TTL elapsed).
   * @returns {number} count of deactivated neurons
   */
  deactivateExpiredNeurons() {
    const result = this._prepStmts.deactivateExpired.run();
    return result.changes;
  }

  /**
   * Get all expired (but still active) neurons.
   * @returns {object[]}
   */
  getExpiredNeurons() {
    return this._prepStmts.getExpiredNeurons.all();
  }

  /**
   * Safe table count — returns 0 if table doesn't exist.
   * @param {string} table
   * @returns {number}
   */
  _safeCount(table, where = '') {
    try {
      const row = this._db.prepare(`SELECT COUNT(*) as c FROM ${table} ${where}`).get();
      return row ? row.c : 0;
    } catch {
      return 0; // Table doesn't exist (e.g., symphony DB queries per-project tables)
    }
  }

  /**
   * Get aggregated memory statistics.
   * @param {string} [projectPath]
   * @returns {object}
   */
  getMemoryStats(projectPath) {
    const pp = projectPath || this._projectPath;
    const stats = {};

    if (this._isSymphony) {
      stats.totalCrossProjectMemories = this._safeCount('cross_project_memories');
      stats.totalGlobalTriggers = this._safeCount('global_workflow_triggers');
      return stats;
    }

    stats.totalNeurons = this._safeCount('neurons');
    stats.activeNeurons = this._safeCount('neurons', 'WHERE is_active = 1');
    stats.expiredNeurons = this._safeCount('neurons', 'WHERE is_active = 0');
    stats.totalSynapses = this._safeCount('synapses');
    stats.totalTasks = this._safeCount('tasks');
    stats.totalSessions = this._safeCount('sessions');

    try {
      stats.byType = this._db.prepare(`
        SELECT type, COUNT(*) as count, AVG(priority) as avgPriority
        FROM neurons WHERE is_active = 1
        GROUP BY type
        ORDER BY count DESC
      `).all();
    } catch {
      stats.byType = [];
    }

    stats.averagePriority = 0;
    try {
      const row = this._db.prepare('SELECT AVG(priority) as avg FROM neurons WHERE is_active = 1').get();
      stats.averagePriority = row ? (row.avg || 0) : 0;
    } catch {}

    return stats;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SYNAPSE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create or update a synapse (directed edge between two neurons).
   * @param {object} synapse
   * @param {string} synapse.source_neuron_id
   * @param {string} synapse.target_neuron_id
   * @param {number} [synapse.weight=0.5]
   * @param {string} [synapse.relationship_type]
   * @returns {object}
   */
  createSynapse(synapse) {
    const id = synapse.id || generateSynapseId();
    const now = Math.floor(Date.now() / 1000);

    const data = {
      id,
      source_neuron_id: synapse.source_neuron_id,
      target_neuron_id: synapse.target_neuron_id,
      weight: synapse.weight ?? 0.5,
      relationship_type: synapse.relationship_type || null,
      created_at: now,
      last_activated_at: now,
      activation_count: 0,
    };

    this._prepStmts.createSynapse.run(data);
    return this._db.prepare('SELECT * FROM synapses WHERE id = ?').get(id);
  }

  /**
   * Get all synapses connected to a neuron.
   * @param {string} neuronId
   * @param {string} [direction] — 'outgoing', 'incoming', or undefined for both
   * @returns {object[]}
   */
  getSynapses(neuronId, direction) {
    if (direction === 'outgoing') {
      return this._prepStmts.getOutgoingSynapses.all(neuronId);
    }
    if (direction === 'incoming') {
      return this._prepStmts.getIncomingSynapses.all(neuronId);
    }
    return this._prepStmts.getSynapsesForNeuron.all(neuronId, neuronId);
  }

  /**
   * Get neurons related to a given neuron (follows synapses in both directions).
   * @param {string} neuronId
   * @param {object} [opts]
   * @param {number} [opts.depth=1] — how many hops to follow
   * @param {number} [opts.limit=20]
   * @returns {object[]}
   */
  getRelatedNeurons(neuronId, opts = {}) {
    const maxDepth = opts.depth || 1;
    const limit = opts.limit || 20;
    const seen = new Set([neuronId]);
    const results = [];

    let currentBatch = [neuronId];

    for (let depth = 0; depth < maxDepth; depth++) {
      if (currentBatch.length === 0) break;

      const phStr = currentBatch.map(() => '?').join(',');
      const related = this._db.prepare(`
        SELECT DISTINCT n.* FROM neurons n
        JOIN synapses s ON (s.source_neuron_id = n.id OR s.target_neuron_id = n.id)
        WHERE (s.source_neuron_id IN (${phStr}) OR s.target_neuron_id IN (${phStr}))
        AND n.id NOT IN (${currentBatch.map(() => '?').join(',')})
        AND n.is_active = 1
        LIMIT ?
      `).all(...currentBatch, ...currentBatch, ...currentBatch, limit);

      for (const row of related) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          results.push(row);
        }
      }

      currentBatch = related.filter(r => !seen.has(r.id)).map(r => r.id);
    }

    return results;
  }

  /**
   * Delete a synapse.
   * @param {string} id
   * @returns {boolean}
   */
  deleteSynapse(id) {
    const result = this._prepStmts.deleteSynapse.run(id);
    return result.changes > 0;
  }

  /**
   * Record that a synapse was activated (traversed).
   * @param {string} id
   */
  touchSynapse(id) {
    this._prepStmts.updateSynapseActivation.run(id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TASK OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Store a task.
   * @param {object} task
   * @returns {object}
   */
  storeTask(task) {
    const id = task.id || generateTaskId();
    const now = Math.floor(Date.now() / 1000);

    const data = {
      id,
      session_id: task.session_id || null,
      description: task.description,
      status: task.status || 'pending',
      priority: task.priority || 0,
      created_at: task.created_at || now,
      completed_at: task.completed_at || null,
      project_path: task.project_path || this._projectPath || '',
      mode_used: task.mode_used || null,
      result_summary: task.result_summary || null,
      related_memories: JSON.stringify(task.related_memories || []),
    };

    this._prepStmts.storeTask.run(data);
    return this._prepStmts.getTask.get(id);
  }

  /**
   * Get a task by ID.
   * @param {string} id
   * @returns {object|null}
   */
  getTask(id) {
    return this._prepStmts.getTask.get(id) || null;
  }

  /**
   * Update task status.
   * @param {string} id
   * @param {string} status
   * @param {string} [resultSummary]
   * @returns {boolean}
   */
  updateTaskStatus(id, status, resultSummary) {
    const completedAt = status === 'completed' || status === 'failed' ? Math.floor(Date.now() / 1000) : null;
    const result = this._prepStmts.updateTaskStatus.run(status, completedAt, resultSummary || null, id);
    return result.changes > 0;
  }

  /**
   * List tasks with optional filters.
   * @param {object} opts
   * @returns {{ tasks: object[], total: number }}
   */
  listTasks(opts = {}) {
    const conditions = [];
    const params = [];

    if (opts.status) {
      conditions.push('status = ?');
      params.push(opts.status);
    }

    if (opts.projectPath) {
      conditions.push('project_path = ?');
      params.push(opts.projectPath);
    } else if (this._projectPath && !this._isSymphony) {
      conditions.push('project_path = ?');
      params.push(this._projectPath);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const limit = opts.limit || 50;
    const offset = opts.offset || 0;

    const countRow = this._db.prepare(`SELECT COUNT(*) as total FROM tasks ${where}`).get(...params);
    const rows = this._db.prepare(`SELECT * FROM tasks ${where} ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

    return { tasks: rows, total: countRow.total };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Save a session (insert or update by id).
   * @param {object} session
   * @returns {object}
   */
  saveSession(session) {
    const now = Math.floor(Date.now() / 1000);
    const id = session.id || 'default';

    const data = {
      id,
      project_path: session.project_path || this._projectPath || '',
      name: session.name || id,
      created_at: session.created_at || now,
      last_activity_at: session.last_activity_at || now,
      mode: session.mode || null,
      git_branch: session.git_branch || null,
      git_commit_hash: session.git_commit_hash || null,
      active_task_id: session.active_task_id || null,
      open_tabs: JSON.stringify(session.open_tabs || []),
      active_tab: session.active_tab || null,
      panel_layout: JSON.stringify(session.panel_layout || {}),
      chat_summary: session.chat_summary || null,
      metadata: JSON.stringify(session.metadata || {}),
    };

    this._prepStmts.saveSession.run(data);
    return this._prepStmts.loadSession.get(id);
  }

  /**
   * Load a session by ID.
   * @param {string} id
   * @returns {object|null}
   */
  loadSession(id) {
    const row = this._prepStmts.loadSession.get(id);
    if (!row) return null;

    // Parse JSON fields
    return {
      ...row,
      open_tabs: tryParseJSON(row.open_tabs, []),
      panel_layout: tryParseJSON(row.panel_layout, {}),
      metadata: tryParseJSON(row.metadata, {}),
    };
  }

  /**
   * List sessions for a project.
   * @param {string} [projectPath]
   * @returns {object[]}
   */
  listSessions(projectPath) {
    const pp = projectPath || this._projectPath;
    if (!pp) return [];

    const rows = this._db.prepare(`
      SELECT * FROM sessions WHERE project_path = ? ORDER BY last_activity_at DESC
    `).all(pp);

    return rows.map(row => ({
      ...row,
      open_tabs: tryParseJSON(row.open_tabs, []),
      panel_layout: tryParseJSON(row.panel_layout, {}),
      metadata: tryParseJSON(row.metadata, {}),
    }));
  }

  /**
   * Delete a session.
   * @param {string} id
   * @returns {boolean}
   */
  deleteSession(id) {
    const result = this._prepStmts.deleteSession.run(id);
    return result.changes > 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Log an audit entry.
   * @param {string} dimension
   * @param {number} score — 0.0 to 1.0
   * @param {object} [details]
   * @param {string} [projectPath]
   * @returns {number} audit log id
   */
  logAudit(dimension, score, details, projectPath) {
    const now = Math.floor(Date.now() / 1000);
    const result = this._prepStmts.logAudit.run(
      now,
      dimension,
      score,
      JSON.stringify(details || {}),
      projectPath || this._projectPath || ''
    );
    return result.lastInsertRowid;
  }

  /**
   * Get audit history.
   * @param {object} [opts]
   * @returns {object[]}
   */
  getAuditHistory(opts = {}) {
    const conditions = [];
    const params = [];

    if (opts.projectPath) {
      conditions.push('project_path = ?');
      params.push(opts.projectPath);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const limit = opts.limit || 20;

    return this._db.prepare(`
      SELECT * FROM audit_log ${where} ORDER BY run_at DESC LIMIT ?
    `).all(...params, limit);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CROSS-PROJECT OPERATIONS (Symphony DB only)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Share a memory across projects.
   * @param {object} memory
   * @returns {object}
   */
  shareMemory(memory) {
    if (!this._isSymphony) {
      throw new Error('[MemoryDB] shareMemory is only available on the symphony database');
    }

    const id = memory.id || generateId();
    const now = Math.floor(Date.now() / 1000);

    const data = {
      id,
      type: memory.type,
      content: memory.content,
      metadata: JSON.stringify(memory.metadata || {}),
      priority: memory.priority ?? 0.5,
      source_project: memory.source_project || null,
      target_projects: JSON.stringify(memory.target_projects || []),
      created_at: now,
      last_shared_at: now,
      share_count: 0,
    };

    this._db.prepare(`
      INSERT OR REPLACE INTO cross_project_memories (id, type, content, metadata, priority, source_project, target_projects, created_at, last_shared_at, share_count)
      VALUES (@id, @type, @content, @metadata, @priority, @source_project, @target_projects, @created_at, @last_shared_at, @share_count)
    `).run(data);

    return this._db.prepare('SELECT * FROM cross_project_memories WHERE id = ?').get(id);
  }

  /**
   * Get cross-project memories.
   * @param {object} [opts]
   * @returns {object[]}
   */
  getCrossProjectMemories(opts = {}) {
    const conditions = [];
    const params = [];

    if (opts.type) {
      conditions.push('type = ?');
      params.push(opts.type);
    }

    if (opts.projectPath) {
      conditions.push('(source_project = ? OR target_projects LIKE ?)');
      params.push(opts.projectPath, `%${opts.projectPath}%`);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const limit = opts.limit || 50;

    return this._db.prepare(`SELECT * FROM cross_project_memories ${where} ORDER BY priority DESC, created_at DESC LIMIT ?`).all(...params, limit);
  }

  /**
   * Register a global workflow trigger.
   * @param {object} trigger
   * @returns {object}
   */
  registerTrigger(trigger) {
    if (!this._isSymphony) {
      throw new Error('[MemoryDB] registerTrigger is only available on the symphony database');
    }

    const id = trigger.id || generateTriggerId();
    const now = Math.floor(Date.now() / 1000);

    this._db.prepare(`
      INSERT OR REPLACE INTO global_workflow_triggers (id, workflow_id, trigger_event, filter_condition, created_at, is_active, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, trigger.workflow_id, trigger.trigger_event, trigger.filter_condition || null, now, trigger.is_active !== false ? 1 : 0, trigger.description || null);

    return this._db.prepare('SELECT * FROM global_workflow_triggers WHERE id = ?').get(id);
  }

  /**
   * List all global workflow triggers.
   * @returns {object[]}
   */
  listGlobalTriggers() {
    return this._db.prepare('SELECT * FROM global_workflow_triggers WHERE is_active = 1 ORDER BY created_at DESC').all();
  }

  /**
   * List all triggers (including inactive).
   * @returns {object[]}
   */
  listAllTriggers() {
    return this._db.prepare('SELECT * FROM global_workflow_triggers ORDER BY created_at DESC').all();
  }

  /**
   * Remove a global workflow trigger.
   * @param {string} id
   * @returns {boolean}
   */
  unregisterTrigger(id) {
    const result = this._db.prepare('DELETE FROM global_workflow_triggers WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VECTOR STORE OPERATIONS (Phase 4 — RAG & Memory Enhancement)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check whether Supabase is available for vector storage.
   * @returns {boolean}
   */
  isSupabaseAvailable() {
    return this._supabaseAvailable;
  }

  /**
   * Check whether the local vector store is available.
   * @returns {boolean}
   */
  isLocalVectorStoreAvailable() {
    return this._localVectorStore !== null;
  }

  /**
   * Get the local vector store instance (if available).
   * @returns {LocalVectorStore|null}
   */
  getLocalVectorStore() {
    return this._localVectorStore;
  }

  /**
   * Store a text embedding using the available vector backend.
   *
   * Uses Supabase if available, otherwise falls back to the local vector store.
   *
   * @param {string} text - The text content to store
   * @param {Float32Array|number[]} embedding - The embedding vector
   * @param {object} [metadata] - Optional metadata
   * @param {object} [supabaseClient] - Optional Supabase client (required if using Supabase backend)
   * @returns {Promise<object|null>} The stored entry, or null if no backend available
   */
  async storeVector(text, embedding, metadata, supabaseClient) {
    // Try Supabase first
    if (this._supabaseAvailable && supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from('vectors')
          .insert({
            text,
            embedding: Array.from(embedding),
            metadata: metadata || {},
          })
          .select()
          .single();

        if (!error && data) {
          return data;
        }

        // Supabase failed — log and fall through to local
        console.warn('[MemoryDB] Supabase vector store failed:', error?.message);
        this._supabaseAvailable = false;
      } catch (err) {
        console.warn('[MemoryDB] Supabase vector store error:', err.message);
        this._supabaseAvailable = false;
      }
    }

    // Fall back to local vector store
    if (this._localVectorStore) {
      return this._localVectorStore.addEmbedding(text, embedding, metadata);
    }

    console.warn('[MemoryDB] No vector backend available to store embedding.');
    return null;
  }

  /**
   * Search for similar vectors using the available backend.
   *
   * Uses Supabase if available, otherwise falls back to the local vector store.
   *
   * @param {string} query - The query text (for reference)
   * @param {Float32Array|number[]} embedding - The query embedding vector
   * @param {number} [limit=10] - Max results
   * @param {object} [supabaseClient] - Optional Supabase client (required if using Supabase backend)
   * @returns {Promise<Array>} Ranked results with similarity scores
   */
  async searchVectors(query, embedding, limit = 10, supabaseClient) {
    // Try Supabase first
    if (this._supabaseAvailable && supabaseClient) {
      try {
        const { data, error } = await supabaseClient.rpc('match_vectors', {
          query_embedding: Array.from(embedding),
          match_threshold: 0.5,
          match_count: limit,
        });

        if (!error && data) {
          return data.map(row => ({
            id: row.id,
            text: row.text,
            metadata: row.metadata,
            score: row.similarity,
            source: 'supabase',
          }));
        }

        // Supabase failed — log and fall through to local
        console.warn('[MemoryDB] Supabase vector search failed:', error?.message);
        this._supabaseAvailable = false;
      } catch (err) {
        console.warn('[MemoryDB] Supabase vector search error:', err.message);
        this._supabaseAvailable = false;
      }
    }

    // Fall back to local vector store
    if (this._localVectorStore) {
      const results = this._localVectorStore.search(query, embedding, limit);
      return results.map(r => ({ ...r, source: 'local' }));
    }

    console.warn('[MemoryDB] No vector backend available for search.');
    return [];
  }

  /**
   * Delete a vector entry by ID.
   *
   * @param {number} id - The vector entry ID
   * @param {object} [supabaseClient] - Optional Supabase client
   * @returns {Promise<boolean>}
   */
  async deleteVector(id, supabaseClient) {
    if (this._supabaseAvailable && supabaseClient) {
      try {
        const { error } = await supabaseClient
          .from('vectors')
          .delete()
          .eq('id', id);

        if (!error) return true;
        this._supabaseAvailable = false;
      } catch {
        this._supabaseAvailable = false;
      }
    }

    if (this._localVectorStore) {
      return this._localVectorStore.delete(id);
    }

    return false;
  }

  /**
   * Clear all vectors from the available backend.
   *
   * @param {object} [supabaseClient] - Optional Supabase client
   * @returns {Promise<boolean>}
   */
  async clearVectors(supabaseClient) {
    if (this._supabaseAvailable && supabaseClient) {
      try {
        const { error } = await supabaseClient
          .from('vectors')
          .delete()
          .neq('id', 0);

        if (!error) return true;
        this._supabaseAvailable = false;
      } catch {
        this._supabaseAvailable = false;
      }
    }

    if (this._localVectorStore) {
      this._localVectorStore.clear();
      return true;
    }

    return false;
  }

  /**
   * Get the total count of stored vectors.
   *
   * @param {object} [supabaseClient] - Optional Supabase client
   * @returns {Promise<number>}
   */
  async countVectors(supabaseClient) {
    if (this._supabaseAvailable && supabaseClient) {
      try {
        const { count, error } = await supabaseClient
          .from('vectors')
          .select('*', { count: 'exact', head: true });

        if (!error) return count;
        this._supabaseAvailable = false;
      } catch {
        this._supabaseAvailable = false;
      }
    }

    if (this._localVectorStore) {
      return this._localVectorStore.count();
    }

    return 0;
  }
}

// ── Utility ──────────────────────────────────────────────────────────────────

function tryParseJSON(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

module.exports = { MemoryDatabase };
