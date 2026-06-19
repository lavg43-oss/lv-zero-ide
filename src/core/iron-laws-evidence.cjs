/**
 * lv-zero — Iron Laws Evidence Store (Phase 3)
 *
 * Simple module that stores/retrieves evidence for iron law checks.
 * Evidence is stored in .lv-zero/evidence/<taskId>.json per project.
 *
 * Evidence structure:
 * { taskId, timestamp, type: "root_cause"|"verification"|"spec_check", content, passed, details }
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getEvidenceDir(projectPath) {
  return path.join(projectPath, '.lv-zero', 'evidence');
}

function ensureEvidenceDir(projectPath) {
  const dir = getEvidenceDir(projectPath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  } catch (err) {
    console.warn(`[IronLawsEvidence] Could not create evidence dir: ${err.message}`);
    return null;
  }
}

function getEvidencePath(projectPath, taskId) {
  const dir = getEvidenceDir(projectPath);
  // Sanitize taskId to prevent path traversal
  const safeId = String(taskId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(dir, `${safeId}.json`);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get evidence for a specific task.
 * @param {string} projectPath - Path to the project
 * @param {string} taskId - Task identifier
 * @returns {object|null} Evidence object or null if not found
 */
function getEvidence(projectPath, taskId) {
  try {
    if (!projectPath || !taskId) return null;
    const filePath = getEvidencePath(projectPath, taskId);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[IronLawsEvidence] getEvidence error: ${err.message}`);
    return null;
  }
}

/**
 * Save evidence for a specific task.
 * @param {string} projectPath - Path to the project
 * @param {string} taskId - Task identifier
 * @param {object} evidence - Evidence object (must have type, content, passed)
 */
function saveEvidence(projectPath, taskId, evidence) {
  try {
    if (!projectPath || !taskId || !evidence) {
      console.warn('[IronLawsEvidence] saveEvidence: missing required params');
      return;
    }
    const dir = ensureEvidenceDir(projectPath);
    if (!dir) return;

    const record = {
      taskId,
      timestamp: new Date().toISOString(),
      type: evidence.type || 'unknown',
      content: evidence.content || '',
      passed: evidence.passed === true,
      details: evidence.details || null,
    };

    const filePath = getEvidencePath(projectPath, taskId);
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[IronLawsEvidence] saveEvidence error: ${err.message}`);
  }
}

/**
 * Get a summary of all evidence for a project.
 * @param {string} projectPath - Path to the project
 * @returns {object} Summary with total, by_type, and recent entries
 */
function getEvidenceSummary(projectPath) {
  try {
    if (!projectPath) {
      return { total: 0, by_type: {}, recent: [] };
    }

    const dir = getEvidenceDir(projectPath);
    if (!fs.existsSync(dir)) {
      return { total: 0, by_type: {}, recent: [] };
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const allEvidence = [];

    for (const file of files) {
      try {
        const filePath = path.join(dir, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        allEvidence.push(parsed);
      } catch (e) {
        // Skip corrupt files
        continue;
      }
    }

    // Sort by timestamp descending
    allEvidence.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Count by type
    const byType = {};
    for (const ev of allEvidence) {
      const t = ev.type || 'unknown';
      if (!byType[t]) byType[t] = 0;
      byType[t]++;
    }

    return {
      total: allEvidence.length,
      by_type: byType,
      recent: allEvidence.slice(0, 10),
    };
  } catch (err) {
    console.warn(`[IronLawsEvidence] getEvidenceSummary error: ${err.message}`);
    return { total: 0, by_type: {}, recent: [] };
  }
}

/**
 * Clear evidence for a specific task.
 * @param {string} projectPath - Path to the project
 * @param {string} taskId - Task identifier
 */
function clearEvidence(projectPath, taskId) {
  try {
    if (!projectPath || !taskId) return;
    const filePath = getEvidencePath(projectPath, taskId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn(`[IronLawsEvidence] clearEvidence error: ${err.message}`);
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────
module.exports = {
  getEvidence,
  saveEvidence,
  getEvidenceSummary,
  clearEvidence,
};
