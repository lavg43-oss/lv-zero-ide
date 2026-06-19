/**
 * lv-zero — Diagnose Wizard (5-Step Guided Debugging Engine)
 *
 * Builds on Iron Law #1: "NO FIXES WITHOUT ROOT CAUSE"
 * Provides a structured 5-step debugging workflow:
 *   1. reproduce  (Reproducir)
 *   2. isolate    (Aislar)
 *   3. hypothesize (Hipótesis)
 *   4. instrument (Instrumentar)
 *   5. fix_and_test (Reparar & Testear)
 *
 * Sessions stored as .lv-zero/debug-sessions/<id>.json
 * Completing the wizard saves evidence via iron-laws-evidence.cjs.
 *
 * All functions wrapped in try/catch — failures never crash the app.
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ─── Step Definitions ────────────────────────────────────────────────────────

const STEPS = [
  {
    id: 'reproduce',
    label: 'Reproducir',
    labelEn: 'Reproduce',
    description: 'Produce the specific error or bug systematically — describe input, expected vs actual output, and reproduction steps.',
    icon: '🔍',
  },
  {
    id: 'isolate',
    label: 'Aislar',
    labelEn: 'Isolate',
    description: 'Isolate the root cause by narrowing down variables — which module, function, or condition triggers the bug?',
    icon: '🎯',
  },
  {
    id: 'hypothesize',
    label: 'Hipótesis',
    labelEn: 'Hypothesize',
    description: 'Hypothesize what is causing the behavior — formulate a clear root cause statement.',
    icon: '💡',
  },
  {
    id: 'instrument',
    label: 'Instrumentar',
    labelEn: 'Instrument',
    description: 'Instrument the code to test the hypothesis — add logs, assertions, or minimal experiments to confirm.',
    icon: '🔧',
  },
  {
    id: 'fix_and_test',
    label: 'Reparar & Testear',
    labelEn: 'Fix & Test',
    description: 'Apply the fix and test it — verify the bug is resolved and no regressions were introduced.',
    icon: '✅',
  },
];

const STEP_IDS = STEPS.map((s) => s.id);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSessionsDir(projectPath) {
  return path.join(projectPath, '.lv-zero', 'debug-sessions');
}

function ensureSessionsDir(projectPath) {
  try {
    const dir = getSessionsDir(projectPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  } catch (err) {
    console.warn(`[DiagnoseWizard] Could not create sessions dir: ${err.message}`);
    return null;
  }
}

function getSessionPath(projectPath, sessionId) {
  const dir = getSessionsDir(projectPath);
  const safeId = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(dir, `${safeId}.json`);
}

function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function generateId() {
  return `debug_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now() {
  return new Date().toISOString();
}

// ─── Default Session Shape ───────────────────────────────────────────────────

function createDefaultSession(projectPath) {
  return {
    id: generateId(),
    projectPath,
    createdAt: now(),
    updatedAt: now(),
    completedAt: null,
    currentStepIndex: 0,
    isComplete: false,
    steps: STEPS.map((step, i) => ({
      stepId: step.id,
      label: step.label,
      icon: step.icon,
      completed: false,
      data: {},
      timestamp: null,
    })),
    summary: '',
    errorLog: '',
    fixDescription: '',
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Create a new debug session.
 * @param {string} projectPath - Path to the project
 * @returns {object} { success: true, session } or { success: false, error }
 */
function createSession(projectPath) {
  try {
    if (!projectPath) {
      return { success: false, error: 'projectPath is required' };
    }
    const dir = ensureSessionsDir(projectPath);
    if (!dir) {
      return { success: false, error: 'Could not create sessions directory' };
    }

    const session = createDefaultSession(projectPath);
    const filePath = getSessionPath(projectPath, session.id);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');

    return { success: true, session };
  } catch (err) {
    console.warn(`[DiagnoseWizard] createSession error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Retrieve a session by ID.
 * @param {string} projectPath - Path to the project
 * @param {string} sessionId - Session identifier
 * @returns {object} { success: true, session } or { success: false, error }
 */
function getSession(projectPath, sessionId) {
  try {
    if (!projectPath || !sessionId) {
      return { success: false, error: 'projectPath and sessionId are required' };
    }
    const filePath = getSessionPath(projectPath, sessionId);
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `Session not found: ${sessionId}` };
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const session = JSON.parse(raw);
    return { success: true, session };
  } catch (err) {
    console.warn(`[DiagnoseWizard] getSession error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Update a session with partial data.
 * @param {string} projectPath - Path to the project
 * @param {string} sessionId - Session identifier
 * @param {object} updates - Partial session fields to update
 * @returns {object} { success: true, session } or { success: false, error }
 */
function updateSession(projectPath, sessionId, updates) {
  try {
    if (!projectPath || !sessionId || !updates) {
      return { success: false, error: 'projectPath, sessionId, and updates are required' };
    }
    const result = getSession(projectPath, sessionId);
    if (!result.success) return result;

    const session = result.session;
    const allowedFields = ['currentStepIndex', 'summary', 'errorLog', 'fixDescription'];
    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        session[key] = updates[key];
      }
    }
    session.updatedAt = now();

    const filePath = getSessionPath(projectPath, sessionId);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');

    return { success: true, session };
  } catch (err) {
    console.warn(`[DiagnoseWizard] updateSession error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * List all debug sessions for a project.
 * @param {string} projectPath - Path to the project
 * @returns {object} { success: true, sessions } or { success: false, error }
 */
function listSessions(projectPath) {
  try {
    if (!projectPath) {
      return { success: false, error: 'projectPath is required' };
    }
    const dir = getSessionsDir(projectPath);
    if (!fs.existsSync(dir)) {
      return { success: true, sessions: [] };
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const sessions = [];

    for (const file of files) {
      try {
        const filePath = path.join(dir, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const s = JSON.parse(raw);
        sessions.push(s);
      } catch (e) {
        // Skip corrupt files
        continue;
      }
    }

    // Sort by createdAt descending
    sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return { success: true, sessions };
  } catch (err) {
    console.warn(`[DiagnoseWizard] listSessions error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Delete a debug session.
 * @param {string} projectPath - Path to the project
 * @param {string} sessionId - Session identifier
 * @returns {object} { success: true } or { success: false, error }
 */
function deleteSession(projectPath, sessionId) {
  try {
    if (!projectPath || !sessionId) {
      return { success: false, error: 'projectPath and sessionId are required' };
    }
    const filePath = getSessionPath(projectPath, sessionId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { success: true };
  } catch (err) {
    console.warn(`[DiagnoseWizard] deleteSession error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Advance to the next step with data collected from the current step.
 * @param {string} projectPath - Path to the project
 * @param {string} sessionId - Session identifier
 * @param {object} stepData - Data collected for the current step
 * @returns {object} { success: true, session, stepChanged } or { success: false, error }
 */
function advanceStep(projectPath, sessionId, stepData) {
  try {
    if (!projectPath || !sessionId) {
      return { success: false, error: 'projectPath and sessionId are required' };
    }
    const result = getSession(projectPath, sessionId);
    if (!result.success) return result;

    const session = result.session;

    if (session.isComplete) {
      return { success: false, error: 'Session is already complete' };
    }

    const currentIdx = session.currentStepIndex;

    if (currentIdx >= STEPS.length) {
      return { success: false, error: 'All steps already completed' };
    }

    // Store data for the current step
    const currentStep = session.steps[currentIdx];
    if (stepData) {
      currentStep.data = { ...currentStep.data, ...stepData };
    }
    currentStep.completed = true;
    currentStep.timestamp = now();

    // Advance index
    const nextIdx = currentIdx + 1;
    session.currentStepIndex = nextIdx;
    session.updatedAt = now();

    const stepChanged = nextIdx < STEPS.length;

    // If all steps done, auto-complete
    if (nextIdx >= STEPS.length) {
      session.isComplete = true;
      session.completedAt = now();
      // Build summary from step data
      const summaryParts = [];
      for (const st of session.steps) {
        if (st.data && Object.keys(st.data).length > 0) {
          summaryParts.push(`[${st.icon} ${st.label}] ${JSON.stringify(st.data)}`);
        }
      }
      session.summary = summaryParts.join('\n');
    }

    const filePath = getSessionPath(projectPath, sessionId);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');

    return { success: true, session, stepChanged };
  } catch (err) {
    console.warn(`[DiagnoseWizard] advanceStep error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Get current step information.
 * @param {string} projectPath - Path to the project
 * @param {string} sessionId - Session identifier
 * @returns {object} { success: true, step, stepIndex, isComplete } or { success: false, error }
 */
function getCurrentStep(projectPath, sessionId) {
  try {
    if (!projectPath || !sessionId) {
      return { success: false, error: 'projectPath and sessionId are required' };
    }
    const result = getSession(projectPath, sessionId);
    if (!result.success) return result;

    const session = result.session;
    const idx = session.currentStepIndex;

    if (idx >= STEPS.length || session.isComplete) {
      return {
        success: true,
        step: null,
        stepIndex: STEPS.length,
        isComplete: true,
        session,
      };
    }

    return {
      success: true,
      step: STEPS[idx],
      stepIndex: idx,
      isComplete: false,
      session,
    };
  } catch (err) {
    console.warn(`[DiagnoseWizard] getCurrentStep error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Complete/finalize a session — saves evidence via iron-laws-evidence if available.
 * @param {string} projectPath - Path to the project
 * @param {string} sessionId - Session identifier
 * @param {object} [evidenceOpts] - Optional evidence overrides
 * @returns {object} { success: true, session, evidenceSaved } or { success: false, error }
 */
function completeSession(projectPath, sessionId, evidenceOpts) {
  try {
    if (!projectPath || !sessionId) {
      return { success: false, error: 'projectPath and sessionId are required' };
    }
    const result = getSession(projectPath, sessionId);
    if (!result.success) return result;

    const session = result.session;

    // Force complete
    session.isComplete = true;
    session.completedAt = now();
    session.currentStepIndex = STEPS.length;
    session.updatedAt = now();

    // Build summary if not set
    if (!session.summary) {
      const summaryParts = [];
      for (const st of session.steps) {
        if (st.data && Object.keys(st.data).length > 0) {
          summaryParts.push(`[${st.icon} ${st.label}] ${JSON.stringify(st.data)}`);
        }
      }
      session.summary = summaryParts.join('\n');
    }

    const filePath = getSessionPath(projectPath, sessionId);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');

    // Try to save evidence via iron-laws-evidence (non-blocking)
    let evidenceSaved = false;
    try {
      const evidenceModule = require('./iron-laws-evidence.cjs');
      if (evidenceModule && typeof evidenceModule.saveEvidence === 'function') {
        evidenceModule.saveEvidence(projectPath, session.id, {
          type: 'diagnose_wizard',
          content: session.summary || 'Debug session completed',
          passed: true,
          details: {
            sessionId: session.id,
            steps: session.steps.map((s) => ({
              stepId: s.stepId,
              completed: s.completed,
              data: s.data,
            })),
            fixDescription: session.fixDescription || '',
            errorLog: session.errorLog || '',
            evidenceOpts: evidenceOpts || null,
          },
        });
        evidenceSaved = true;
      }
    } catch (evErr) {
      console.warn(`[DiagnoseWizard] Could not save evidence: ${evErr.message}`);
    }

    return { success: true, session, evidenceSaved };
  } catch (err) {
    console.warn(`[DiagnoseWizard] completeSession error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Get a human-readable summary of the session.
 * @param {string} projectPath - Path to the project
 * @param {string} sessionId - Session identifier
 * @returns {object} { success: true, summary } or { success: false, error }
 */
function summarizeSession(projectPath, sessionId) {
  try {
    if (!projectPath || !sessionId) {
      return { success: false, error: 'projectPath and sessionId are required' };
    }
    const result = getSession(projectPath, sessionId);
    if (!result.success) return result;

    const session = result.session;
    const lines = [];
    lines.push(`🧪 Debug Session: ${session.id}`);
    lines.push(`   Created: ${session.createdAt}`);
    lines.push(`   Status:  ${session.isComplete ? '✅ Complete' : '🔄 In Progress'}`);
    lines.push('');

    for (const st of session.steps) {
      const status = st.completed ? '✅' : '⏳';
      const dataStr = st.data && Object.keys(st.data).length > 0
        ? ` — ${JSON.stringify(st.data).slice(0, 80)}`
        : '';
      lines.push(`   ${status} ${st.icon} ${st.label}${dataStr}`);
    }

    if (session.fixDescription) {
      lines.push('');
      lines.push(`   🔧 Fix: ${session.fixDescription}`);
    }
    if (session.errorLog) {
      lines.push(`   📋 Error: ${session.errorLog.slice(0, 200)}`);
    }

    return { success: true, summary: lines.join('\n') };
  } catch (err) {
    console.warn(`[DiagnoseWizard] summarizeSession error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Validate if a transition from current step to target step is allowed.
 * @param {string} projectPath - Path to the project
 * @param {string} sessionId - Session identifier
 * @param {string|number} targetStep - Step ID string or index number
 * @returns {object} { success: true, allowed, reason } or { success: false, error }
 */
function validateStepTransition(projectPath, sessionId, targetStep) {
  try {
    if (!projectPath || !sessionId) {
      return { success: false, error: 'projectPath and sessionId are required' };
    }
    const result = getSession(projectPath, sessionId);
    if (!result.success) return result;

    const session = result.session;

    // Resolve target step index
    let targetIdx;
    if (typeof targetStep === 'number') {
      targetIdx = Math.max(0, Math.min(targetStep, STEPS.length));
    } else if (typeof targetStep === 'string') {
      targetIdx = STEP_IDS.indexOf(targetStep);
      if (targetIdx === -1) {
        return { success: true, allowed: false, reason: `Unknown step: ${targetStep}` };
      }
    } else {
      return { success: true, allowed: false, reason: 'targetStep must be a string (step ID) or number (index)' };
    }

    const currentIdx = session.currentStepIndex;

    if (session.isComplete) {
      return { success: true, allowed: false, reason: 'Session is already complete' };
    }

    // Can only advance forward, never skip more than 1, never go backwards
    if (targetIdx < currentIdx) {
      return { success: true, allowed: false, reason: 'Cannot go back to a previous step' };
    }

    if (targetIdx > currentIdx + 1) {
      return { success: true, allowed: false, reason: 'Cannot skip steps — complete the current step first' };
    }

    // Can only advance if current step has data
    if (targetIdx > currentIdx) {
      const currentStep = session.steps[currentIdx];
      if (!currentStep.completed && (!currentStep.data || Object.keys(currentStep.data).length === 0)) {
        return { success: true, allowed: false, reason: 'Current step has no data — fill in details before advancing' };
      }
    }

    return { success: true, allowed: true, reason: 'Transition allowed' };
  } catch (err) {
    console.warn(`[DiagnoseWizard] validateStepTransition error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Get the step definitions (read-only).
 * @returns {Array} Array of step objects
 */
function getStepDefinitions() {
  return STEPS.map((s) => ({ ...s }));
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  createSession,
  getSession,
  updateSession,
  listSessions,
  deleteSession,
  advanceStep,
  getCurrentStep,
  completeSession,
  summarizeSession,
  validateStepTransition,
  getStepDefinitions,
};
