/**
 * AWF Session Restore — Silent context restoration on session start
 * Converts Antigravity awf-session-restore v7.2 to LV-ZERO native
 * 
 * Actions: restore (auto-triggered), checkpoint (save state), status (check state)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Helpers ──────────────────────────────────────────────────
function safeRead(filepath) {
  try { return fs.readFileSync(filepath, 'utf-8').trim(); }
  catch { return null; }
}

function safeJsonRead(filepath) {
  const raw = safeRead(filepath);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ─── Project Identity ─────────────────────────────────────────
function getProjectIdentity(projectRoot) {
  const identityPath = path.join(projectRoot || process.cwd(), '.project-identity');
  const json = safeJsonRead(identityPath);
  if (json) return { id: json.projectId, name: json.projectName, root: projectRoot };
  
  // Fallback: detect from package.json
  const pkgPath = path.join(projectRoot || process.cwd(), 'package.json');
  const pkg = safeJsonRead(pkgPath);
  if (pkg) return { id: pkg.name, name: pkg.name, root: projectRoot || process.cwd() };
  
  return { id: 'unknown', name: path.basename(projectRoot || process.cwd()), root: projectRoot || process.cwd() };
}

// ─── Git Context ──────────────────────────────────────────────
function getGitContext(projectRoot) {
  const cwd = projectRoot || process.cwd();
  const status = runGit(cwd, 'status --short');
  const lastCommit = runGit(cwd, 'log -1 --oneline');
  const branch = runGit(cwd, 'branch --show-current');
  return { status, lastCommit, branch };
}

function runGit(cwd, args) {
  try {
    const { execSync } = require('child_process');
    return execSync(`git ${args}`, { cwd, encoding: 'utf-8', timeout: 3000 }).trim();
  } catch { return null; }
}

// ─── Plans Context ────────────────────────────────────────────
function getPlansContext(projectRoot) {
  const plansDir = path.join(projectRoot || process.cwd(), 'plans');
  if (!fs.existsSync(plansDir)) return { active: null, recent: [] };
  
  const files = fs.readdirSync(plansDir).filter(f => f.endsWith('.md'));
  const recent = files.slice(0, 5).map(f => {
    const stat = fs.statSync(path.join(plansDir, f));
    return { name: f, modified: stat.mtime.toISOString() };
  }).sort((a, b) => new Date(b.modified) - new Date(a.modified));
  
  return { active: recent[0]?.name || null, recent };
}

// ─── Main Handler ─────────────────────────────────────────────
export default {
  name: 'awf_session_restore',
  description: 'Silent session context restoration. Auto-triggered on session start. Restores project identity, git state, active plans, and last checkpoint from memory. Actions: restore, checkpoint, status.',
  
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['restore', 'checkpoint', 'status'],
        description: 'restore (auto on session start), checkpoint (save current state), status (show current state)'
      },
      projectRoot: {
        type: 'string',
        description: 'Project root directory (optional, defaults to current)'
      }
    },
    required: ['action']
  },

  async handler({ action, projectRoot }) {
    const root = projectRoot || process.cwd();
    
    switch (action) {
      case 'restore': {
        const project = getProjectIdentity(root);
        const git = getGitContext(root);
        const plans = getPlansContext(root);
        
        return {
          restored: true,
          project,
          git: {
            branch: git.branch,
            lastCommit: git.lastCommit,
            changedFiles: git.status?.split('\n').filter(Boolean).map(l => l.trim()) || []
          },
          plans: plans.recent.slice(0, 3).map(p => p.name),
          activePlan: plans.active,
          timestamp: new Date().toISOString(),
          _silent: true // Signal to not print to console
        };
      }
      
      case 'checkpoint': {
        const project = getProjectIdentity(root);
        const git = getGitContext(root);
        const plans = getPlansContext(root);
        
        const checkpoint = {
          project,
          git: { branch: git.branch, lastCommit: git.lastCommit },
          plans: plans.recent.slice(0, 3).map(p => p.name),
          timestamp: new Date().toISOString()
        };
        
        // Save to auto_memoria if available
        try {
          const { handler: memoriaHandler } = await import('./auto_memoria.js');
          await memoriaHandler({ 
            action: 'checkpoint', 
            topic: `session_checkpoint_${project.id}`,
            content: JSON.stringify(checkpoint),
            source: 'awf_session_restore'
          });
        } catch (e) {
          // auto_memoria not available — save to disk fallback
          const checkpointDir = path.join(root, '.lv-zero');
          fs.mkdirSync(checkpointDir, { recursive: true });
          fs.writeFileSync(path.join(checkpointDir, 'session_checkpoint.json'), JSON.stringify(checkpoint, null, 2));
        }
        
        return { checkpointed: true, project: project.name, timestamp: checkpoint.timestamp };
      }
      
      case 'status': {
        const project = getProjectIdentity(root);
        const git = getGitContext(root);
        const plans = getPlansContext(root);
        
        return {
          project: project.name,
          branch: git.branch,
          lastCommit: git.lastCommit,
          changedFiles: git.status?.split('\n').filter(Boolean).length || 0,
          activePlan: plans.active,
          recentPlans: plans.recent.map(p => p.name)
        };
      }
      
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
};
