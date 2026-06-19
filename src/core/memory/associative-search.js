/**
 * Associative Search — Spreading Activation graph recall.
 *
 * Implements a spreading activation algorithm over the neuron/synapse graph:
 *   1. Seed with neurons matching the query via SQL LIKE
 *   2. Follow outgoing synapses, decaying energy at each depth level
 *   3. Accumulate energy from multiple paths
 *   4. Filter by minimum energy, sort descending, return top results
 *
 * The algorithm is inspired by Antigravity's associative memory recall,
 * providing context-aware retrieval that surfaces related memories even
 * when they don't match the query text directly.
 *
 * @module core/memory/associative-search
 */

const { MemoryDatabase } = require('./database.cjs');

class AssociativeSearch {
  /**
   * @param {MemoryDatabase} [database] — optional DB instance for testing/mocking.
   *   If omitted, resolves via MemoryDatabase.getInstance(projectPath).
   */
  constructor(database) {
    this._db = database || null;
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

  // ═══════════════════════════════════════════════════════════════════════════
  // SPREADING ACTIVATION SEARCH
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Spreading activation search — seed with text-matched neurons, then spread
   * energy along synapses to retrieve related memories.
   *
   * @param {string} projectPath
   * @param {string} query — text to match against neuron content
   * @param {object} [opts]
   * @param {number} [opts.maxResults=20] — max results to return
   * @param {number} [opts.maxDepth=3] — max synapse traversal depth
   * @param {number} [opts.energyDecay=0.5] — energy multiplier per hop
   * @param {number} [opts.minEnergy=0.1] — minimum energy to include result
   * @param {boolean} [opts.activeOnly=true] — only consider active neurons
   * @returns {Promise<{ results: Array<{ neuron: object, energy: number, path: string[], depth: number }> }>}
   */
  async search(projectPath, query, opts = {}) {
    const maxResults = opts.maxResults || 20;
    const maxDepth = opts.maxDepth || 3;
    const energyDecay = opts.energyDecay || 0.5;
    const minEnergy = opts.minEnergy || 0.1;
    const activeOnly = opts.activeOnly !== false;

    const db = this._getDB(projectPath);

    // ── Step 1: Seed neurons matching the query ──────────────────────────
    const seedResult = db.searchNeurons({
      query,
      projectPath,
      limit: maxResults * 2,
      activeOnly,
    });
    const seedNeurons = seedResult.neurons || [];

    if (seedNeurons.length === 0) {
      return { results: [] };
    }

    // activationMap: neuronId -> { neuron, energy, path, depth }
    const activationMap = new Map();
    const seenPaths = new Set();

    // Initialize seeds with energy 1.0
    for (const neuron of seedNeurons) {
      activationMap.set(neuron.id, {
        neuron,
        energy: 1.0,
        path: [neuron.id],
        depth: 0,
      });
    }

    // ── Step 2-3: Spread activation along synapses ───────────────────────
    let currentBatch = seedNeurons.map(n => n.id);

    for (let depth = 1; depth <= maxDepth; depth++) {
      if (currentBatch.length === 0) break;

      // Build placeholders for the SQL IN clause
      const ph = currentBatch.map(() => '?').join(',');

      // Find all synapses originating from current batch
      const synapses = db._db.prepare(`
        SELECT s.*, n.type AS target_type, n.content AS target_content,
               n.priority AS target_priority
        FROM synapses s
        JOIN neurons n ON n.id = s.target_neuron_id
        WHERE s.source_neuron_id IN (${ph})
          AND n.is_active = ?
        ORDER BY s.weight DESC
        LIMIT ?
      `).all(...currentBatch, activeOnly ? 1 : 0, maxResults * 3);

      const nextBatchSet = new Set();

      for (const synapse of synapses) {
        const sourceEnergy = activationMap.get(synapse.source_neuron_id)?.energy || 0;
        if (sourceEnergy <= 0) continue;

        const targetId = synapse.target_neuron_id;
        const weight = synapse.weight || 1.0;
        const transferredEnergy = sourceEnergy * weight * energyDecay;

        if (transferredEnergy < minEnergy) continue;

        // Build unique path key to prevent cycles
        const pathKey = `${synapse.source_neuron_id}->${targetId}`;
        if (seenPaths.has(pathKey)) continue;
        seenPaths.add(pathKey);

        // Accumulate energy (multiple paths can reach the same neuron)
        if (activationMap.has(targetId)) {
          const existing = activationMap.get(targetId);
          existing.energy = Math.min(existing.energy + transferredEnergy, 1.0);
          if (depth < existing.depth) existing.depth = depth;
        } else {
          activationMap.set(targetId, {
            neuron: {
              id: targetId,
              type: synapse.target_type,
              content: synapse.target_content,
              priority: synapse.target_priority,
            },
            energy: transferredEnergy,
            path: [...(activationMap.get(synapse.source_neuron_id)?.path || []), targetId],
            depth,
          });
        }

        nextBatchSet.add(targetId);
      }

      currentBatch = Array.from(nextBatchSet);
    }

    // ── Step 4-6: Filter, sort, limit ───────────────────────────────────
    let results = Array.from(activationMap.values())
      .filter(item => item.energy >= minEnergy)
      .sort((a, b) => b.energy - a.energy);

    // Deduplicate by neuron id (keep highest energy entry)
    const seenIds = new Set();
    results = results.filter(item => {
      if (seenIds.has(item.neuron.id)) return false;
      seenIds.add(item.neuron.id);
      return true;
    });

    // Trim to maxResults
    results = results.slice(0, maxResults);

    return {
      results: results.map(item => ({
        neuron: item.neuron,
        energy: Math.round(item.energy * 1000) / 1000,
        path: item.path,
        depth: item.depth,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FIND RELATED
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Find neurons related to a given neuron by following synapses in both
   * directions. Uses single-hop spreading for speed.
   *
   * @param {string} projectPath
   * @param {string} neuronId
   * @param {object} [opts]
   * @param {number} [opts.maxResults=10]
   * @returns {Promise<{ neurons: object[] }>}
   */
  async findRelated(projectPath, neuronId, opts = {}) {
    const maxResults = opts.maxResults || 10;
    const db = this._getDB(projectPath);

    const sourceNeuron = db.getNeuron(neuronId);
    if (!sourceNeuron) {
      return { neurons: [] };
    }

    // Follow outgoing synapses
    const outgoing = db._db.prepare(`
      SELECT n.*, s.weight, s.label
      FROM synapses s
      JOIN neurons n ON n.id = s.target_neuron_id
      WHERE s.source_neuron_id = ? AND n.is_active = 1
      ORDER BY s.weight DESC
      LIMIT ?
    `).all(neuronId, maxResults);

    // Follow incoming synapses (neurons that link to this one)
    const incoming = db._db.prepare(`
      SELECT n.*, s.weight, s.label
      FROM synapses s
      JOIN neurons n ON n.id = s.source_neuron_id
      WHERE s.target_neuron_id = ? AND n.is_active = 1
      ORDER BY s.weight DESC
      LIMIT ?
    `).all(neuronId, maxResults);

    // Merge and deduplicate
    const seen = new Set();
    const merged = [];

    for (const row of [...outgoing, ...incoming]) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        merged.push({
          id: row.id,
          type: row.type,
          content: row.content,
          priority: row.priority,
          synapseWeight: row.weight,
          synapseLabel: row.label || null,
          direction: outgoing.includes(row) ? 'outgoing' : 'incoming',
        });
      }
    }

    // Sort by synapse weight descending
    merged.sort((a, b) => (b.synapseWeight || 0) - (a.synapseWeight || 0));

    return { neurons: merged.slice(0, maxResults) };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD CONTEXT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build a full graph context for a set of neurons — returns neurons and
   * the synapses connecting them, suitable for rendering a subgraph.
   *
   * @param {string} projectPath
   * @param {string[]} neuronIds
   * @returns {Promise<{ neurons: object[], synapses: object[], graph: object }>}
   */
  async buildContext(projectPath, neuronIds) {
    const db = this._getDB(projectPath);

    if (!neuronIds || neuronIds.length === 0) {
      return { neurons: [], synapses: [], graph: { nodes: [], edges: [] } };
    }

    const ph = neuronIds.map(() => '?').join(',');

    // Load neurons
    const neurons = db._db.prepare(
      `SELECT * FROM neurons WHERE id IN (${ph})`
    ).all(...neuronIds);

    // Load synapses between these neurons
    const synapses = db._db.prepare(`
      SELECT * FROM synapses
      WHERE source_neuron_id IN (${ph})
        AND target_neuron_id IN (${ph})
      ORDER BY weight DESC
    `).all(...neuronIds, ...neuronIds);

    // Build graph D3/vis compatible format
    const nodes = neurons.map(n => ({
      id: n.id,
      label: (n.content || '').substring(0, 60),
      type: n.type,
      priority: n.priority,
    }));

    const edges = synapses.map(s => ({
      id: s.id,
      source: s.source_neuron_id,
      target: s.target_neuron_id,
      weight: s.weight,
      label: s.label || '',
    }));

    return {
      neurons,
      synapses,
      graph: { nodes, edges },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// IPC HANDLER REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register associative search IPC handlers on the given ipcMain.
 *
 * Channels:
 *   memory:associative-search — spreading activation search
 *   memory:find-related      — find related neurons by synapse hops
 *   memory:build-context     — build graph context for a set of neurons
 *
 * @param {object} ipcMain
 * @param {AssociativeSearch} searchEngine
 */
function registerAssociativeSearchIPC(ipcMain, searchEngine) {
  if (!ipcMain || !searchEngine) {
    console.warn('[AssociativeSearch] Missing ipcMain or searchEngine — skipping');
    return;
  }

  // ── memory:associative-search ─────────────────────────────────────────
  ipcMain.handle('memory:associative-search', async (_event, payload) => {
    try {
      const { projectPath, query, ...opts } = payload;
      if (!projectPath) return { success: false, error: 'projectPath is required' };
      if (!query) return { success: false, error: 'query is required' };
      const result = await searchEngine.search(projectPath, query, opts);
      return { success: true, ...result };
    } catch (err) {
      console.error('[AssociativeSearch] memory:associative-search error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── memory:find-related ───────────────────────────────────────────────
  ipcMain.handle('memory:find-related', async (_event, payload) => {
    try {
      const { projectPath, neuronId, ...opts } = payload;
      if (!projectPath) return { success: false, error: 'projectPath is required' };
      if (!neuronId) return { success: false, error: 'neuronId is required' };
      const result = await searchEngine.findRelated(projectPath, neuronId, opts);
      return { success: true, ...result };
    } catch (err) {
      console.error('[AssociativeSearch] memory:find-related error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── memory:build-context ──────────────────────────────────────────────
  ipcMain.handle('memory:build-context', async (_event, payload) => {
    try {
      const { projectPath, neuronIds } = payload;
      if (!projectPath) return { success: false, error: 'projectPath is required' };
      if (!neuronIds || !Array.isArray(neuronIds)) {
        return { success: false, error: 'neuronIds array is required' };
      }
      const result = await searchEngine.buildContext(projectPath, neuronIds);
      return { success: true, ...result };
    } catch (err) {
      console.error('[AssociativeSearch] memory:build-context error:', err.message);
      return { success: false, error: err.message };
    }
  });

  console.log('[AssociativeSearch] Associative search IPC handlers registered');
}

module.exports = { AssociativeSearch, registerAssociativeSearchIPC };
