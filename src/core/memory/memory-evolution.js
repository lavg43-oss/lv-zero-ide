/**
 * Memory Evolution — Automatic Pruning, Consolidation & Archiving
 *
 * Manages the lifecycle of neural memories by:
 * - Pruning expired neurons (TTL elapsed)
 * - Consolidating similar neurons via fuzzy content matching
 * - Archiving stale, low-priority neurons
 * - Pruning low-weight synapses
 *
 * A full evolution cycle can be triggered on project close,
 * on a periodic interval, or when neuron count exceeds a threshold.
 *
 * @module memory-evolution
 */

// ═══════════════════════════════════════════════════════════════════════════════
// MemoryEvolution Class
// ═══════════════════════════════════════════════════════════════════════════════

class MemoryEvolution {
  /**
   * @param {import('./database.cjs').MemoryDatabase} database — MemoryDatabase constructor/class (not instance)
   */
  constructor(database) {
    this._Database = database;
  }

  /**
   * Resolve a per-project database instance.
   * @param {string} projectPath
   * @returns {object|null}
   */
  _getDB(projectPath) {
    if (!projectPath || !this._Database) return null;
    try {
      return this._Database.getInstance(projectPath);
    } catch {
      return null;
    }
  }

  /**
   * Get all neurons from the database (simplified query).
   * @param {object} db
   * @param {object} [opts]
   * @returns {object[]}
   */
  _getAllNeurons(db, opts = {}) {
    try {
      const conditions = ['1=1'];
      const params = [];

      if (opts.activeOnly !== false) {
        conditions.push('is_active = 1');
      }
      if (opts.projectPath) {
        conditions.push('project_path = ?');
        params.push(opts.projectPath);
      }

      const where = conditions.join(' AND ');
      const limit = opts.limit ? ` LIMIT ${Number(opts.limit)}` : '';
      const offset = opts.offset ? ` OFFSET ${Number(opts.offset)}` : '';

      return db.raw.prepare(`
        SELECT * FROM neurons WHERE ${where} ORDER BY created_at ASC${limit}${offset}
      `).all(...params);
    } catch {
      return [];
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Step 1: Prune Expired Neurons
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Deactivate all neurons whose TTL has elapsed.
   * @param {string} projectPath
   * @returns {number} — count of deactivated neurons
   */
  async pruneExpired(projectPath) {
    const db = this._getDB(projectPath);
    if (!db) return 0;

    try {
      const count = db.deactivateExpiredNeurons();
      return count;
    } catch (err) {
      console.warn('[MemoryEvolution] pruneExpired error:', err.message);
      return 0;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Step 2: Consolidate Similar Neurons
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Normalize a string for fuzzy matching.
   * @param {string} str
   * @returns {string}
   */
  _normalize(str) {
    if (!str) return '';
    return str.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Compute a simple Jaccard similarity between two strings
   * based on word overlap.
   * @param {string} a
   * @param {string} b
   * @returns {number} — 0.0 to 1.0
   */
  _wordSimilarity(a, b) {
    const normA = this._normalize(a);
    const normB = this._normalize(b);
    if (!normA || !normB) return 0;

    const wordsA = new Set(normA.split(' '));
    const wordsB = new Set(normB.split(' '));

    let intersection = 0;
    let union = wordsA.size + wordsB.size;

    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }
    union -= intersection;

    if (union === 0) return 1;
    return intersection / union;
  }

  /**
   * Merge two neurons, keeping the newer one as the primary.
   * @param {object} db — per-project MemoryDatabase instance
   * @param {object} primary — the neuron to keep
   * @param {object} duplicate — the neuron to merge
   */
  _mergeNeurons(db, primary, duplicate) {
    // Merge metadata
    let mergedMetadata = {};
    try {
      mergedMetadata = JSON.parse(primary.metadata || '{}');
      const dupMeta = JSON.parse(duplicate.metadata || '{}');
      // Merge config/path arrays if they exist
      if (Array.isArray(dupMeta.configFiles) && Array.isArray(mergedMetadata.configFiles)) {
        mergedMetadata.configFiles = [...new Set([...mergedMetadata.configFiles, ...dupMeta.configFiles])];
      }
      if (Array.isArray(dupMeta.relatedPaths) && Array.isArray(mergedMetadata.relatedPaths)) {
        mergedMetadata.relatedPaths = [...new Set([...mergedMetadata.relatedPaths, ...dupMeta.relatedPaths])];
      }
      // Keep higher priority
      if (duplicate.priority > primary.priority) {
        mergedMetadata.originalPriority = primary.priority;
      }
    } catch {
      mergedMetadata = {};
    }

    // Update primary with merged data and higher priority
    try {
      db.raw.prepare(`
        UPDATE neurons SET
          content = ?,
          metadata = ?,
          priority = MAX(priority, ?),
          last_accessed_at = MAX(last_accessed_at, ?),
          access_count = access_count + ?
        WHERE id = ?
      `).run(
        primary.content,  // Keep primary content
        JSON.stringify(mergedMetadata),
        duplicate.priority || 0.5,
        duplicate.last_accessed_at || 0,
        duplicate.access_count || 0,
        primary.id
      );
    } catch (err) {
      console.warn('[MemoryEvolution] merge update error:', err.message);
    }

    // Re-point synapses from duplicate to primary
    try {
      db.raw.prepare(`
        UPDATE synapses SET source_neuron_id = ?
        WHERE source_neuron_id = ? AND target_neuron_id != ?
      `).run(primary.id, duplicate.id, primary.id);
      db.raw.prepare(`
        UPDATE synapses SET target_neuron_id = ?
        WHERE target_neuron_id = ? AND source_neuron_id != ?
      `).run(primary.id, duplicate.id, primary.id);
    } catch {
      // Ignore FK errors
    }

    // Delete duplicate neuron
    try {
      db.deleteNeuron(duplicate.id);
    } catch {
      // Ignore
    }
  }

  /**
   * Consolidate similar neurons via fuzzy content matching.
   * @param {string} projectPath
   * @param {number} [threshold=0.8] — Jaccard similarity threshold (0.0–1.0)
   * @returns {{ merged: number, remaining: number }}
   */
  async consolidateSimilar(projectPath, threshold = 0.8) {
    const db = this._getDB(projectPath);
    if (!db) return { merged: 0, remaining: 0 };

    let merged = 0;

    try {
      const neurons = this._getAllNeurons(db, { activeOnly: true });

      // Group by type first for efficiency
      const byType = {};
      for (const n of neurons) {
        if (!byType[n.type]) byType[n.type] = [];
        byType[n.type].push(n);
      }

      for (const [type, group] of Object.entries(byType)) {
        // Skip types that are naturally unique (error, insight)
        if (type === 'error' || type === 'insight') continue;

        const compared = new Set();

        for (let i = 0; i < group.length; i++) {
          if (compared.has(group[i].id)) continue;

          for (let j = i + 1; j < group.length; j++) {
            if (compared.has(group[j].id)) continue;

            const sim = this._wordSimilarity(group[i].content, group[j].content);

            if (sim >= threshold) {
              // Keep the newer/more-accessed one
              const aPriority = group[i].priority || 0.5;
              const bPriority = group[j].priority || 0.5;
              const aAccess = group[i].access_count || 0;
              const bAccess = group[j].access_count || 0;

              // Score: weighted combination for determining primary
              const aScore = aPriority * 0.6 + Math.min(aAccess / 10, 0.4);
              const bScore = bPriority * 0.6 + Math.min(bAccess / 10, 0.4);

              const primary = aScore >= bScore ? group[i] : group[j];
              const duplicate = aScore >= bScore ? group[j] : group[i];

              this._mergeNeurons(db, primary, duplicate);
              compared.add(duplicate.id);
              merged++;
            }
          }
        }
      }
    } catch (err) {
      console.warn('[MemoryEvolution] consolidateSimilar error:', err.message);
    }

    return { merged, remaining: 0 };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Step 3: Archive Stale, Low-Priority Neurons
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Deactivate stale, low-priority neurons that haven't been accessed recently.
   * @param {string} projectPath
   * @param {number} [daysSinceAccess=30] — age threshold in days
   * @param {number} [maxPriority=0.2] — maximum priority to archive
   * @returns {number} — count of archived neurons
   */
  async archiveStale(projectPath, daysSinceAccess = 30, maxPriority = 0.2) {
    const db = this._getDB(projectPath);
    if (!db) return 0;

    try {
      const cutoff = Math.floor(Date.now() / 1000) - (daysSinceAccess * 86400);

      const result = db.raw.prepare(`
        UPDATE neurons SET is_active = 0
        WHERE is_active = 1
          AND priority <= ?
          AND last_accessed_at < ?
          AND (ttl IS NULL OR ttl <= 0)
      `).run(maxPriority, cutoff);

      return result.changes;
    } catch (err) {
      console.warn('[MemoryEvolution] archiveStale error:', err.message);
      return 0;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Step 4: Prune Low-Weight Synapses
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Delete synapses with weight below the minimum threshold.
   * @param {string} projectPath
   * @param {number} [minWeight=0.1] — minimum weight to keep
   * @returns {number} — count of pruned synapses
   */
  async pruneSynapses(projectPath, minWeight = 0.1) {
    const db = this._getDB(projectPath);
    if (!db) return 0;

    try {
      const result = db.raw.prepare(`
        DELETE FROM synapses WHERE weight < ?
      `).run(minWeight);

      return result.changes;
    } catch (err) {
      console.warn('[MemoryEvolution] pruneSynapses error:', err.message);
      return 0;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Full Evolution Cycle
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Run all four evolution steps and return a summary.
   * @param {string} projectPath
   * @returns {object} — { pruned, consolidated, archived, synapsesPruned }
   */
  async fullCycle(projectPath) {
    const db = this._getDB(projectPath);
    const result = {
      pruned: 0,
      consolidated: { merged: 0 },
      archived: 0,
      synapsesPruned: 0,
    };

    if (!db) return result;

    try {
      // Step 1: Prune expired neurons
      result.pruned = await this.pruneExpired(projectPath);
    } catch (err) {
      console.warn('[MemoryEvolution] fullCycle/pruneExpired error:', err.message);
    }

    try {
      // Step 2: Consolidate similar neurons
      result.consolidated = await this.consolidateSimilar(projectPath);
    } catch (err) {
      console.warn('[MemoryEvolution] fullCycle/consolidateSimilar error:', err.message);
    }

    try {
      // Step 3: Archive stale, low-priority neurons
      result.archived = await this.archiveStale(projectPath);
    } catch (err) {
      console.warn('[MemoryEvolution] fullCycle/archiveStale error:', err.message);
    }

    try {
      // Step 4: Prune low-weight synapses
      result.synapsesPruned = await this.pruneSynapses(projectPath);
    } catch (err) {
      console.warn('[MemoryEvolution] fullCycle/pruneSynapses error:', err.message);
    }

    return result;
  }

  /**
   * Run a single evolution step based on name.
   * @param {string} projectPath
   * @param {string} step — one of: 'pruneExpired', 'consolidateSimilar', 'archiveStale', 'pruneSynapses'
   * @param {object} [opts] — optional parameters for the step
   * @returns {number|object}
   */
  async runStep(projectPath, step, opts = {}) {
    switch (step) {
      case 'pruneExpired':
        return await this.pruneExpired(projectPath);
      case 'consolidateSimilar':
        return await this.consolidateSimilar(projectPath, opts.threshold);
      case 'archiveStale':
        return await this.archiveStale(projectPath, opts.daysSinceAccess, opts.maxPriority);
      case 'pruneSynapses':
        return await this.pruneSynapses(projectPath, opts.minWeight);
      default:
        throw new Error(`Unknown evolution step: ${step}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// IPC Registration
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Register IPC handlers for the Memory Evolution system.
 * @param {import('electron').IpcMain} ipcMain
 * @param {MemoryEvolution} evolution — MemoryEvolution instance
 */
function registerMemoryEvolutionIPC(ipcMain, evolution) {
  if (!ipcMain || !evolution) {
    console.warn('[MemoryEvolutionIPC] Invalid arguments — skipping registration');
    return;
  }

  ipcMain.handle('memory:evolve', async (_event, payload) => {
    try {
      const projectPath = (payload && payload.projectPath) || '';
      const step = (payload && payload.step) || null;
      const opts = (payload && payload.opts) || {};

      let results;

      if (step) {
        // Run a single step
        const stepResult = await evolution.runStep(projectPath, step, opts);
        results = { step, result: stepResult };
      } else {
        // Run full cycle
        results = await evolution.fullCycle(projectPath);
      }

      return { success: true, results };
    } catch (err) {
      console.error('[MemoryEvolutionIPC] memory:evolve error:', err.message);
      return { success: false, error: err.message };
    }
  });

  console.log('[MemoryEvolutionIPC] Registered: memory:evolve');
}

module.exports = { MemoryEvolution, registerMemoryEvolutionIPC };
