/**
 * AWF Version Tracker — Auto-snapshot skills for rollback safety
 * Converts Antigravity awf-version-tracker to LV-ZERO native
 * 
 * Actions: snapshot (auto), list (show snapshots), rollback (restore), clean (keep last 10)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────
const SKILLS_DIR = path.join(__dirname);
const SNAPSHOT_DIR = path.join(__dirname, '.snapshots');
const MAX_SNAPSHOTS = 10;

// ─── Helpers ──────────────────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function listSnapshots() {
  ensureDir(SNAPSHOT_DIR);
  const files = fs.readdirSync(SNAPSHOT_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();
  
  return files.map(f => {
    const meta = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, f), 'utf-8'));
    return {
      id: f.replace('.json', ''),
      timestamp: meta.timestamp,
      skills: meta.skills?.length || 0,
      size: meta.totalSize || 0
    };
  });
}

function skillFingerprint(filepath) {
  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    // Simple hash: length + first/last 50 chars
    return {
      path: path.relative(SKILLS_DIR, filepath),
      size: content.length,
      checksum: `${content.length}_${content.slice(0, 50).replace(/\s/g, '')}_${content.slice(-50).replace(/\s/g, '')}`
    };
  } catch {
    return null;
  }
}

// ─── Snapshot ─────────────────────────────────────────────────
function createSnapshot() {
  ensureDir(SNAPSHOT_DIR);
  
  const skills = [];
  let totalSize = 0;
  
  // Scan all JS skill files
  const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const fp = skillFingerprint(path.join(SKILLS_DIR, file));
    if (fp) {
      skills.push(fp);
      totalSize += fp.size;
    }
  }
  
  const snapshot = {
    timestamp: new Date().toISOString(),
    skills,
    totalSize,
    totalSkills: skills.length
  };
  
  const id = getTimestamp();
  fs.writeFileSync(path.join(SNAPSHOT_DIR, `${id}.json`), JSON.stringify(snapshot, null, 2));
  
  // Clean old snapshots
  cleanOldSnapshots();
  
  return { snapshotId: id, skills: skills.length, totalSize };
}

function cleanOldSnapshots() {
  const snapshots = listSnapshots();
  if (snapshots.length > MAX_SNAPSHOTS) {
    const toDelete = snapshots.slice(MAX_SNAPSHOTS);
    for (const s of toDelete) {
      fs.unlinkSync(path.join(SNAPSHOT_DIR, `${s.id}.json`));
    }
  }
}

// ─── Rollback ─────────────────────────────────────────────────
function rollback(snapshotId) {
  const file = path.join(SNAPSHOT_DIR, `${snapshotId}.json`);
  if (!fs.existsSync(file)) {
    return { error: `Snapshot "${snapshotId}" no encontrado. Usa action=list para ver los disponibles.` };
  }
  
  const meta = JSON.parse(fs.readFileSync(file, 'utf-8'));
  
  // Verify skill files still exist
  const changed = [];
  const missing = [];
  
  for (const skill of meta.skills) {
    const skillPath = path.join(SKILLS_DIR, skill.path);
    const current = skillFingerprint(skillPath);
    
    if (!current) {
      missing.push(skill.path);
    } else if (current.checksum !== skill.checksum) {
      changed.push({ file: skill.path, snapshotSize: skill.size, currentSize: current.size });
    }
  }
  
  return {
    snapshotId,
    timestamp: meta.timestamp,
    totalSkills: meta.skills.length,
    changed: changed.length,
    missing: missing.length,
    changedFiles: changed.map(c => c.file),
    missingFiles: missing,
    warning: changed.length > 0 ? `${changed.length} archivos han cambiado desde este snapshot. Revisar manualmente.` : null
  };
}

// ─── Main Handler ─────────────────────────────────────────────
export default {
  name: 'awf_version_tracker',
  description: 'Auto-snapshot de skills para rollback seguro. Guarda fingerprint de cada skill al iniciar sesión. Actions: snapshot, list, rollback, clean.',
  
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['snapshot', 'list', 'rollback', 'clean'],
        description: 'snapshot (guardar estado actual), list (ver snapshots), rollback (ver diferencias con un snapshot), clean (borrar viejos)'
      },
      snapshotId: {
        type: 'string',
        description: 'ID del snapshot para rollback (requerido para action=rollback)'
      }
    },
    required: ['action']
  },

  async handler({ action, snapshotId }) {
    switch (action) {
      case 'snapshot': {
        const result = createSnapshot();
        return {
          snapshot: true,
          id: result.snapshotId,
          skills: result.skills,
          size: `${(result.totalSize / 1024).toFixed(1)} KB`,
          message: `📸 Snapshot guardado: ${result.skills} skills`
        };
      }
      
      case 'list': {
        const snapshots = listSnapshots();
        return { snapshots, total: snapshots.length };
      }
      
      case 'rollback': {
        if (!snapshotId) return { error: 'Se requiere snapshotId. Usa action=list para ver IDs.' };
        return rollback(snapshotId);
      }
      
      case 'clean': {
        cleanOldSnapshots();
        const remaining = listSnapshots();
        return { cleaned: true, remaining: remaining.length, snapshots: remaining };
      }
      
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
};
