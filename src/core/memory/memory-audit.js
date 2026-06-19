/**
 * Memory Audit — 6-Dimension Quality Audit System
 *
 * Evaluates the health and quality of a project's neural memory
 * across six dimensions: completeness, recency, relevance,
 * connectivity, health, and diversity.
 *
 * Each dimension produces a score (0.0–1.0) with detailed metrics.
 * An overall weighted score and actionable recommendations are
 * generated automatically.
 *
 * @module memory-audit
 */

const crypto = require('crypto');

// ─── Dimension Weights ───────────────────────────────────────────────────────
const DIMENSION_WEIGHTS = {
  completeness: 0.20,
  recency:      0.15,
  relevance:    0.20,
  connectivity: 0.15,
  health:       0.15,
  diversity:    0.15,
};

// ─── Score Thresholds for Recommendations ────────────────────────────────────
const RECOMMENDATION_THRESHOLDS = {
  completeness:  { low: 0.4, medium: 0.7 },
  recency:       { low: 0.3, medium: 0.6 },
  relevance:     { low: 0.4, medium: 0.7 },
  connectivity:  { low: 0.3, medium: 0.6 },
  health:        { low: 0.4, medium: 0.7 },
  diversity:     { low: 0.3, medium: 0.6 },
};

// ─── Memory Types (from memory-types.js) ─────────────────────────────────────
const ALL_MEMORY_TYPES = [
  'decision',
  'context',
  'error',
  'insight',
  'feedback',
  'instruction',
  'goal',
  'preference',
  'milestone',
  'reference',
];

// ═══════════════════════════════════════════════════════════════════════════════
// MemoryAudit Class
// ═══════════════════════════════════════════════════════════════════════════════

class MemoryAudit {
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

  // ───────────────────────────────────────────────────────────────────────────
  // Completeness — Are all memory types populated?
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Audit the completeness dimension.
   * @param {object} db — per-project MemoryDatabase instance
   * @returns {{ score: number, details: object }}
   */
  _auditCompleteness(db) {
    const byType = [];
    const typesPresent = new Set();

    try {
      const rows = db.raw.prepare(`
        SELECT type, COUNT(*) as count
        FROM neurons WHERE is_active = 1
        GROUP BY type
      `).all();
      for (const r of rows) {
        byType.push({ type: r.type, count: r.count });
        typesPresent.add(r.type);
      }
    } catch {
      // Fallback: empty
    }

    const typesMissing = ALL_MEMORY_TYPES.filter(t => !typesPresent.has(t));
    const totalNeurons = byType.reduce((sum, t) => sum + t.count, 0);

    // Score: ratio of present types to all expected types
    const presentRatio = ALL_MEMORY_TYPES.length > 0
      ? typesPresent.size / ALL_MEMORY_TYPES.length
      : 0;

    // Bonus: if at least one neuron exists per present type
    const densityBonus = totalNeurons > 0 ? Math.min(totalNeurons / 100, 0.2) : 0;
    const score = Math.min(presentRatio + densityBonus, 1.0);

    return {
      score: Math.round(score * 1000) / 1000,
      details: {
        totalNeurons,
        typesPresent: Array.from(typesPresent),
        typesMissing,
        presentRatio: Math.round(presentRatio * 1000) / 1000,
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Recency — How recent are the memories?
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Audit the recency dimension.
   * @param {object} db — per-project MemoryDatabase instance
   * @returns {{ score: number, details: object }}
   */
  _auditRecency(db) {
    const now = Math.floor(Date.now() / 1000);
    let ages = [];

    try {
      const rows = db.raw.prepare(`
        SELECT created_at FROM neurons
        WHERE is_active = 1 AND created_at IS NOT NULL
        ORDER BY created_at ASC
      `).all();
      ages = rows.map(r => now - r.created_at);
    } catch {
      ages = [];
    }

    if (ages.length === 0) {
      return { score: 0, details: { medianAge: 0, oldest: 0, newest: 0, neuronCount: 0 } };
    }

    const sorted = [...ages].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianAge = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
    const oldest = sorted[sorted.length - 1];
    const newest = sorted[0];

    // Score: based on median age. Newer = better.
    // 1 day = ~1.0, 7 days = ~0.7, 30 days = ~0.3, 90+ days = ~0.1
    const medianDays = medianAge / 86400;
    const score = Math.max(0, Math.min(1, 1 / (1 + medianDays * 0.15)));

    return {
      score: Math.round(score * 1000) / 1000,
      details: {
        medianAge: Math.round(medianAge),
        oldest: Math.round(oldest),
        newest: Math.round(newest),
        medianDays: Math.round(medianDays * 10) / 10,
        neuronCount: ages.length,
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Relevance — Are high-priority memories well-represented?
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Audit the relevance dimension.
   * @param {object} db — per-project MemoryDatabase instance
   * @returns {{ score: number, details: object }}
   */
  _auditRelevance(db) {
    let avgPriority = 0;
    let highPriorityCount = 0;
    let lowPriorityCount = 0;
    let total = 0;

    try {
      const rows = db.raw.prepare(`
        SELECT priority FROM neurons
        WHERE is_active = 1 AND priority IS NOT NULL
      `).all();

      total = rows.length;
      if (total > 0) {
        const sum = rows.reduce((s, r) => s + r.priority, 0);
        avgPriority = sum / total;
        highPriorityCount = rows.filter(r => r.priority >= 0.7).length;
        lowPriorityCount = rows.filter(r => r.priority <= 0.3).length;
      }
    } catch {
      // Fallback
    }

    // Score: mixture of average priority and high-priority ratio
    const highRatio = total > 0 ? highPriorityCount / total : 0;
    const avgScore = avgPriority; // 0.0–1.0
    const score = avgScore * 0.6 + highRatio * 0.4;

    return {
      score: Math.round(score * 1000) / 1000,
      details: {
        avgPriority: Math.round(avgPriority * 1000) / 1000,
        highPriorityCount,
        lowPriorityCount,
        totalNeuronsWithPriority: total,
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Connectivity — Are neurons well-connected via synapses?
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Audit the connectivity dimension.
   * @param {object} db — per-project MemoryDatabase instance
   * @returns {{ score: number, details: object }}
   */
  _auditConnectivity(db) {
    let totalSynapses = 0;
    let totalNeurons = 0;
    let orphanedNeurons = 0;

    try {
      totalSynapses = db._safeCount('synapses');
      totalNeurons = db._safeCount('neurons', 'WHERE is_active = 1');
    } catch {
      // Fallback
    }

    // Find orphaned neurons (no incoming or outgoing synapses)
    if (totalNeurons > 0) {
      try {
        const connected = new Set();
        const synRows = db.raw.prepare(`
          SELECT source_neuron_id AS sid, target_neuron_id AS tid FROM synapses
        `).all();
        for (const s of synRows) {
          connected.add(s.sid);
          connected.add(s.tid);
        }
        orphanedNeurons = totalNeurons - connected.size;
        if (orphanedNeurons < 0) orphanedNeurons = 0;
      } catch {
        orphanedNeurons = totalNeurons; // Can't determine, assume worst
      }
    }

    const avgSynapsesPerNeuron = totalNeurons > 0
      ? totalSynapses / totalNeurons
      : 0;
    const orphanedRatio = totalNeurons > 0
      ? orphanedNeurons / totalNeurons
      : 1;

    // Score: based on avg synapses per neuron and orphan ratio
    // Target: ~3+ synapses/neuron, <20% orphaned
    const synapseScore = Math.min(avgSynapsesPerNeuron / 3, 1.0);
    const orphanScore = 1 - orphanedRatio;
    const score = synapseScore * 0.5 + orphanScore * 0.5;

    return {
      score: Math.round(score * 1000) / 1000,
      details: {
        totalSynapses,
        orphanedNeurons,
        avgSynapsesPerNeuron: Math.round(avgSynapsesPerNeuron * 100) / 100,
        orphanedRatio: Math.round(orphanedRatio * 1000) / 1000,
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Health — Are there expired/stale memories?
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Audit the health dimension.
   * @param {object} db — per-project MemoryDatabase instance
   * @returns {{ score: number, details: object }}
   */
  _auditHealth(db) {
    let expiredCount = 0;
    let activeCount = 0;

    try {
      expiredCount = db._safeCount('neurons', 'WHERE is_active = 0');
      activeCount = db._safeCount('neurons', 'WHERE is_active = 1');
    } catch {
      // Fallback
    }

    const total = expiredCount + activeCount;
    const expiredRatio = total > 0 ? expiredCount / total : 0;

    // Score: lower expired ratio = better health
    // <10% expired → near 1.0, 50% expired → 0.5, >90% expired → 0.1
    const score = Math.max(0, 1 - expiredRatio * 1.5);

    return {
      score: Math.round(score * 1000) / 1000,
      details: {
        expiredCount,
        activeCount,
        totalNeurons: total,
        expiredRatio: Math.round(expiredRatio * 1000) / 1000,
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Diversity — Are all memory types represented with good distribution?
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Audit the diversity dimension using Shannon entropy.
   * @param {object} db — per-project MemoryDatabase instance
   * @returns {{ score: number, details: object }}
   */
  _auditDiversity(db) {
    let typeDistribution = {};

    try {
      const rows = db.raw.prepare(`
        SELECT type, COUNT(*) as count
        FROM neurons WHERE is_active = 1
        GROUP BY type
      `).all();
      for (const r of rows) {
        typeDistribution[r.type] = r.count;
      }
    } catch {
      typeDistribution = {};
    }

    const types = Object.keys(typeDistribution);
    const total = Object.values(typeDistribution).reduce((s, c) => s + c, 0);

    // Shannon entropy
    let entropy = 0;
    if (total > 0) {
      for (const count of Object.values(typeDistribution)) {
        const p = count / total;
        if (p > 0) {
          entropy -= p * Math.log2(p);
        }
      }
    }

    // Max entropy for available types: log2(number of types present)
    const maxEntropy = types.length > 0 ? Math.log2(types.length) : 0;
    const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0;

    // Coverage: ratio of present types to all expected types
    const coverage = ALL_MEMORY_TYPES.length > 0
      ? types.length / ALL_MEMORY_TYPES.length
      : 0;

    // Score: equal weight to entropy and coverage
    const score = normalizedEntropy * 0.5 + coverage * 0.5;

    return {
      score: Math.round(score * 1000) / 1000,
      details: {
        typeDistribution,
        shannonEntropy: Math.round(entropy * 1000) / 1000,
        normalizedEntropy: Math.round(normalizedEntropy * 1000) / 1000,
        typesPresent: types,
        typesCount: types.length,
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Recommendations Generator
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Generate actionable recommendations based on audit results.
   * @param {object} dimensions — all dimension results
   * @returns {string[]}
   */
  _generateRecommendations(dimensions) {
    const recs = [];

    for (const [dim, result] of Object.entries(dimensions)) {
      const thresholds = RECOMMENDATION_THRESHOLDS[dim];
      if (!thresholds) continue;

      if (result.score < thresholds.low) {
        switch (dim) {
          case 'completeness':
            recs.push(`Low completeness (${result.score}). Missing types: ${result.details.typesMissing.join(', ') || 'none'}. Consider storing memories for missing types.`);
            break;
          case 'recency':
            recs.push(`Low recency (${result.score}). Median memory age is ${result.details.medianDays || '?'} days. Consider refreshing older memories.`);
            break;
          case 'relevance':
            recs.push(`Low relevance (${result.score}). Average priority is ${result.details.avgPriority}. Consider promoting high-value memories.`);
            break;
          case 'connectivity':
            recs.push(`Low connectivity (${result.score}). ${result.details.orphanedNeurons} neurons are orphaned. Consider creating synapses between related memories.`);
            break;
          case 'health':
            recs.push(`Low health (${result.score}). ${result.details.expiredRatio * 100}% of neurons are expired. Run memory evolution to prune.`);
            break;
          case 'diversity':
            recs.push(`Low diversity (${result.score}). Only ${result.details.typesCount}/${ALL_MEMORY_TYPES.length} types present. Broaden memory collection.`);
            break;
        }
      } else if (result.score < thresholds.medium) {
        switch (dim) {
          case 'completeness':
            recs.push(`Moderate completeness (${result.score}). Consider filling gaps in: ${result.details.typesMissing.slice(0, 3).join(', ') || 'none'}.`);
            break;
          case 'recency':
            recs.push(`Moderate recency (${result.score}). Some memories may be stale. Review older entries.`);
            break;
          case 'relevance':
            recs.push(`Moderate relevance (${result.score}). ${result.details.lowPriorityCount} low-priority memories may need review.`);
            break;
          case 'connectivity':
            recs.push(`Moderate connectivity (${result.score}). Avg synapses/neuron: ${result.details.avgSynapsesPerNeuron}. Consider enriching connections.`);
            break;
          case 'health':
            recs.push(`Moderate health (${result.score}). ${result.details.expiredRatio * 100}% expired. Schedule a cleanup.`);
            break;
          case 'diversity':
            recs.push(`Moderate diversity (${result.score}). Entropy: ${result.details.normalizedEntropy}. Consider diversifying memory types.`);
            break;
        }
      }
    }

    // Add global recommendations if overall is low
    return recs;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Main Audit Entry Point
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Run a full 6-dimension quality audit on a project.
   * @param {string} projectPath
   * @returns {object} — full audit report
   */
  async audit(projectPath) {
    const db = this._getDB(projectPath);
    const timestamp = new Date().toISOString();

    const result = {
      timestamp,
      projectPath,
      dimensions: {},
      overall: 0,
      recommendations: [],
    };

    if (!db) {
      // No database available — return zeroed audit
      for (const dim of Object.keys(DIMENSION_WEIGHTS)) {
        result.dimensions[dim] = { score: 0, details: {} };
      }
      result.overall = 0;
      result.recommendations = ['No database available for this project.'];
      return result;
    }

    // Run all 6 dimensions
    const dimensions = {
      completeness: this._auditCompleteness(db),
      recency: this._auditRecency(db),
      relevance: this._auditRelevance(db),
      connectivity: this._auditConnectivity(db),
      health: this._auditHealth(db),
      diversity: this._auditDiversity(db),
    };

    result.dimensions = dimensions;

    // Calculate weighted overall score
    let weightedSum = 0;
    let weightTotal = 0;
    for (const [dim, dimResult] of Object.entries(dimensions)) {
      const weight = DIMENSION_WEIGHTS[dim] || 0;
      weightedSum += dimResult.score * weight;
      weightTotal += weight;
    }
    result.overall = weightTotal > 0
      ? Math.round((weightedSum / weightTotal) * 1000) / 1000
      : 0;

    // Generate recommendations
    result.recommendations = this._generateRecommendations(dimensions);

    // Persist audit log
    try {
      for (const [dim, dimResult] of Object.entries(dimensions)) {
        db.logAudit(dim, dimResult.score, dimResult.details, projectPath);
      }
      // Log overall as a special entry
      db.logAudit('overall', result.overall, { recommendations: result.recommendations }, projectPath);
    } catch (err) {
      console.warn('[MemoryAudit] Could not persist audit log:', err.message);
    }

    return result;
  }

  /**
   * Get audit history for a project.
   * @param {string} projectPath
   * @param {number} [limit=10]
   * @returns {object[]}
   */
  async getHistory(projectPath, limit = 10) {
    const db = this._getDB(projectPath);
    if (!db) return [];

    try {
      return db.getAuditHistory({ projectPath, limit });
    } catch (err) {
      console.warn('[MemoryAudit] Could not get audit history:', err.message);
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// IPC Registration
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Register IPC handlers for the Memory Audit system.
 * @param {import('electron').IpcMain} ipcMain
 * @param {MemoryAudit} audit — MemoryAudit instance
 */
function registerMemoryAuditIPC(ipcMain, audit) {
  if (!ipcMain || !audit) {
    console.warn('[MemoryAuditIPC] Invalid arguments — skipping registration');
    return;
  }

  ipcMain.handle('memory:audit', async (_event, payload) => {
    try {
      const projectPath = (payload && payload.projectPath) || '';
      const result = await audit.audit(projectPath);
      return { success: true, audit: result };
    } catch (err) {
      console.error('[MemoryAuditIPC] memory:audit error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('memory:audit-history', async (_event, payload) => {
    try {
      const projectPath = (payload && payload.projectPath) || '';
      const limit = (payload && payload.limit) || 10;
      const entries = await audit.getHistory(projectPath, limit);
      return { success: true, entries };
    } catch (err) {
      console.error('[MemoryAuditIPC] memory:audit-history error:', err.message);
      return { success: false, error: err.message };
    }
  });

  console.log('[MemoryAuditIPC] Registered: memory:audit, memory:audit-history');
}

module.exports = { MemoryAudit, registerMemoryAuditIPC };
