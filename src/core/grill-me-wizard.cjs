/**
 * lv-zero — Grill Me Wizard (7-Question Scope Interview Engine)
 *
 * Interactive scope interview that happens BEFORE spec generation.
 * Asks 7 scoping questions to understand what the user wants to build,
 * then feeds the structured answers into the spec generation pipeline.
 *
 * Design principles:
 *   - Non-blocking: all operations wrapped in try/catch
 *   - Sessions stored as .lv-zero/scoping-sessions/<id>.json
 *   - Each question has validation rules
 *   - Answers feed enriched spec generation via scopingAnswers parameter
 *   - Reuses pattern from diagnose-wizard for consistency
 *
 * v1.0 — Grill Me Wizard
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ─── The 7 Scoping Questions ──────────────────────────────────────────────
// Each question has: id, order, question text, hint, validation rule,
// and answer type (text / textarea).

const SCOPING_QUESTIONS = [
  {
    id: 'problem',
    order: 0,
    question: 'What problem are you trying to solve?',
    hint: 'Describe the pain point or opportunity you want to address.',
    placeholder: 'e.g., "I need to automate invoice generation for my small business"',
    type: 'textarea',
    validation: {
      required: true,
      minLength: 10,
      message: 'Please describe the problem in at least 10 characters.',
    },
  },
  {
    id: 'users',
    order: 1,
    question: 'Who will use this?',
    hint: 'Describe your target users — developers, businesses, general public, yourself?',
    placeholder: 'e.g., "Freelancers who need quick estimates"',
    type: 'textarea',
    validation: {
      required: true,
      minLength: 5,
      message: 'Please specify at least who the users are.',
    },
  },
  {
    id: 'core_feature',
    order: 2,
    question: 'What is the ONE core feature?',
    hint: 'If this project did only one thing, what should it be? The essential must-have.',
    placeholder: 'e.g., "Generate a PDF invoice from a simple text description"',
    type: 'textarea',
    validation: {
      required: true,
      minLength: 10,
      message: 'Please describe the core feature in at least 10 characters.',
    },
  },
  {
    id: 'constraints',
    order: 3,
    question: 'Any constraints? (time, budget, tech, platform)',
    hint: 'Deadlines, budget limits, required tech stack, platform restrictions.',
    placeholder: 'e.g., "Must work offline, budget under $500, deliver in 2 weeks"',
    type: 'textarea',
    validation: {
      required: false,
      minLength: 0,
    },
  },
  {
    id: 'competition',
    order: 4,
    question: 'Similar tools or services? What makes yours different?',
    hint: 'Are there existing solutions? What will make your project stand out?',
    placeholder: 'e.g., "Toggl tracks time but doesn\'t generate invoices"',
    type: 'textarea',
    validation: {
      required: false,
      minLength: 0,
    },
  },
  {
    id: 'success',
    order: 5,
    question: 'What does success look like?',
    hint: 'How will you know this project is done and working? Define measurable outcomes.',
    placeholder: 'e.g., "User can create and download an invoice in under 30 seconds"',
    type: 'textarea',
    validation: {
      required: true,
      minLength: 10,
      message: 'Please describe what success looks like in at least 10 characters.',
    },
  },
  {
    id: 'mvp',
    order: 6,
    question: 'What is the minimum viable first version?',
    hint: 'What is the simplest thing that delivers value? Cut scope down to essentials.',
    placeholder: 'e.g., "A single-page web app with a form and PDF download — no auth, no dashboard"',
    type: 'textarea',
    validation: {
      required: true,
      minLength: 10,
      message: 'Please describe the MVP in at least 10 characters.',
    },
  },
];

const QUESTION_IDS = SCOPING_QUESTIONS.map((q) => q.id);

// ─── Helpers ──────────────────────────────────────────────────────────────

function getSessionsDir(projectPath) {
  return path.join(projectPath, '.lv-zero', 'scoping-sessions');
}

function ensureSessionsDir(projectPath) {
  try {
    const dir = getSessionsDir(projectPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  } catch (err) {
    console.warn(`[GrillMeWizard] Could not create sessions dir: ${err.message}`);
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
  return `scope_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now() {
  return new Date().toISOString();
}

function createDefaultSession(projectPath) {
  return {
    sessionId: generateId(),
    projectPath,
    createdAt: now(),
    updatedAt: now(),
    status: 'in_progress', // in_progress | completed | cancelled
    currentStep: 0,
    answers: {},
    skippedQuestions: [],
    stepStatuses: {}, // { [questionId]: 'pending' | 'answered' | 'skipped' }
  };
}

// ─── Validation ───────────────────────────────────────────────────────────

function validateAnswer(questionId, value) {
  const question = SCOPING_QUESTIONS.find((q) => q.id === questionId);
  if (!question) {
    return { valid: false, message: 'Unknown question ID.' };
  }

  const val = (value || '').trim();

  if (question.validation.required && val.length === 0) {
    return { valid: false, message: question.validation.message || 'This field is required.' };
  }

  if (question.validation.minLength > 0 && val.length < question.validation.minLength) {
    return { valid: false, message: question.validation.message || `Minimum ${question.validation.minLength} characters required.` };
  }

  return { valid: true, message: null };
}

// ─── Session CRUD ─────────────────────────────────────────────────────────

/**
 * Create a new scoping session for the given project.
 * Returns the session object, or null on failure.
 */
function createSession(projectPath) {
  try {
    if (!projectPath) {
      console.warn('[GrillMeWizard] createSession: no project path provided');
      return null;
    }

    const dir = ensureSessionsDir(projectPath);
    if (!dir) return null;

    const session = createDefaultSession(projectPath);
    const filePath = getSessionPath(projectPath, session.sessionId);

    // Initialize step statuses
    SCOPING_QUESTIONS.forEach((q) => {
      session.stepStatuses[q.id] = 'pending';
    });

    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
    console.log(`[GrillMeWizard] Session created: ${session.sessionId}`);
    return session;
  } catch (err) {
    console.warn(`[GrillMeWizard] createSession error: ${err.message}`);
    return null;
  }
}

/**
 * Load a scoping session by ID.
 * Returns the session object, or null if not found or on error.
 */
function loadSession(projectPath, sessionId) {
  try {
    if (!projectPath || !sessionId) {
      console.warn('[GrillMeWizard] loadSession: projectPath and sessionId required');
      return null;
    }

    const filePath = getSessionPath(projectPath, sessionId);
    if (!fs.existsSync(filePath)) {
      console.warn(`[GrillMeWizard] Session not found: ${sessionId}`);
      return null;
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[GrillMeWizard] loadSession error: ${err.message}`);
    return null;
  }
}

/**
 * Save (overwrite) a session to disk.
 * Returns true on success, false on failure.
 */
function saveSession(projectPath, session) {
  try {
    if (!projectPath || !session || !session.sessionId) {
      console.warn('[GrillMeWizard] saveSession: invalid session data');
      return false;
    }

    session.updatedAt = now();
    const filePath = getSessionPath(projectPath, session.sessionId);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.warn(`[GrillMeWizard] saveSession error: ${err.message}`);
    return false;
  }
}

/**
 * List all scoping sessions for a project.
 * Returns an array of session summaries (without full answers) sorted by creation date.
 */
function listSessions(projectPath) {
  try {
    if (!projectPath) return [];

    const dir = getSessionsDir(projectPath);
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const sessions = [];

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
        const session = JSON.parse(raw);
        sessions.push({
          sessionId: session.sessionId,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          status: session.status,
          currentStep: session.currentStep,
          answerCount: session.answers ? Object.keys(session.answers).length : 0,
          totalQuestions: SCOPING_QUESTIONS.length,
        });
      } catch {
        // Skip corrupted session files
      }
    }

    // Sort by creation date (newest first)
    sessions.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return sessions;
  } catch (err) {
    console.warn(`[GrillMeWizard] listSessions error: ${err.message}`);
    return [];
  }
}

/**
 * Delete a scoping session.
 * Returns true on success, false on failure.
 */
function deleteSession(projectPath, sessionId) {
  try {
    if (!projectPath || !sessionId) return false;

    const filePath = getSessionPath(projectPath, sessionId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[GrillMeWizard] Session deleted: ${sessionId}`);
    }
    return true;
  } catch (err) {
    console.warn(`[GrillMeWizard] deleteSession error: ${err.message}`);
    return false;
  }
}

// ─── Answer Management ────────────────────────────────────────────────────

/**
 * Submit an answer for a specific question in a session.
 * Validates the answer, saves it, and updates the session state.
 * Returns { success, error?, session? }.
 */
function submitAnswer(projectPath, sessionId, questionId, answer) {
  try {
    if (!projectPath || !sessionId || !questionId) {
      return { success: false, error: 'projectPath, sessionId, and questionId are required' };
    }

    // Validate question exists
    const question = SCOPING_QUESTIONS.find((q) => q.id === questionId);
    if (!question) {
      return { success: false, error: `Unknown question: ${questionId}` };
    }

    // Validate answer
    const validation = validateAnswer(questionId, answer);
    if (!validation.valid) {
      return { success: false, error: validation.message };
    }

    // Load session
    const session = loadSession(projectPath, sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    if (session.status !== 'in_progress') {
      return { success: false, error: `Session is already ${session.status}` };
    }

    // Store answer
    session.answers[questionId] = (answer || '').trim();
    session.stepStatuses[questionId] = 'answered';
    session.updatedAt = now();

    // Advance to next step if this is the current step
    if (session.currentStep === question.order) {
      const nextStep = question.order + 1;
      if (nextStep < SCOPING_QUESTIONS.length) {
        session.currentStep = nextStep;
      }
    }

    // Check if all questions are answered
    const allAnswered = SCOPING_QUESTIONS.every(
      (q) => session.stepStatuses[q.id] === 'answered' || session.stepStatuses[q.id] === 'skipped'
    );
    if (allAnswered) {
      session.status = 'completed';
    }

    // Save
    const saved = saveSession(projectPath, session);
    if (!saved) {
      return { success: false, error: 'Failed to save session' };
    }

    return {
      success: true,
      session: {
        sessionId: session.sessionId,
        status: session.status,
        currentStep: session.currentStep,
        stepStatuses: session.stepStatuses,
        isComplete: session.status === 'completed',
      },
    };
  } catch (err) {
    console.warn(`[GrillMeWizard] submitAnswer error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Skip a question (mark as skipped without providing an answer).
 * Returns { success, error?, session? }.
 */
function skipQuestion(projectPath, sessionId, questionId) {
  try {
    if (!projectPath || !sessionId || !questionId) {
      return { success: false, error: 'projectPath, sessionId, and questionId are required' };
    }

    const question = SCOPING_QUESTIONS.find((q) => q.id === questionId);
    if (!question) {
      return { success: false, error: `Unknown question: ${questionId}` };
    }

    const session = loadSession(projectPath, sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    if (session.status !== 'in_progress') {
      return { success: false, error: `Session is already ${session.status}` };
    }

    session.stepStatuses[questionId] = 'skipped';
    if (!session.skippedQuestions) {
      session.skippedQuestions = [];
    }
    if (!session.skippedQuestions.includes(questionId)) {
      session.skippedQuestions.push(questionId);
    }
    session.updatedAt = now();

    // Advance to next step
    if (session.currentStep === question.order) {
      const nextStep = question.order + 1;
      if (nextStep < SCOPING_QUESTIONS.length) {
        session.currentStep = nextStep;
      }
    }

    // Check if all questions are handled
    const allHandled = SCOPING_QUESTIONS.every(
      (q) => session.stepStatuses[q.id] === 'answered' || session.stepStatuses[q.id] === 'skipped'
    );
    if (allHandled) {
      session.status = 'completed';
    }

    saveSession(projectPath, session);

    return {
      success: true,
      session: {
        sessionId: session.sessionId,
        status: session.status,
        currentStep: session.currentStep,
        stepStatuses: session.stepStatuses,
        isComplete: session.status === 'completed',
      },
    };
  } catch (err) {
    console.warn(`[GrillMeWizard] skipQuestion error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Get the current question for a session.
 * Returns the question object, or null if all questions are done.
 */
function getCurrentQuestion(projectPath, sessionId) {
  try {
    const session = loadSession(projectPath, sessionId);
    if (!session) return null;

    if (session.status !== 'in_progress') return null;

    const currentStep = session.currentStep;
    if (currentStep >= SCOPING_QUESTIONS.length) return null;

    const question = SCOPING_QUESTIONS[currentStep];
    if (!question) return null;

    // Check if already answered
    if (session.stepStatuses[question.id] === 'answered' || session.stepStatuses[question.id] === 'skipped') {
      // Find the next unanswered question
      for (let i = currentStep + 1; i < SCOPING_QUESTIONS.length; i++) {
        const q = SCOPING_QUESTIONS[i];
        if (session.stepStatuses[q.id] !== 'answered' && session.stepStatuses[q.id] !== 'skipped') {
          return q;
        }
      }
      return null;
    }

    return question;
  } catch (err) {
    console.warn(`[GrillMeWizard] getCurrentQuestion error: ${err.message}`);
    return null;
  }
}

/**
 * Get the full session state for the renderer, including all questions/answers.
 * Returns a structured object or null.
 */
function getSessionState(projectPath, sessionId) {
  try {
    const session = loadSession(projectPath, sessionId);
    if (!session) return null;

    const questions = SCOPING_QUESTIONS.map((q) => ({
      id: q.id,
      order: q.order,
      question: q.question,
      hint: q.hint,
      type: q.type,
      validation: {
        required: q.validation.required,
        minLength: q.validation.minLength,
      },
      answer: session.answers[q.id] || null,
      status: session.stepStatuses[q.id] || 'pending',
    }));

    return {
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      status: session.status,
      currentStep: session.currentStep,
      totalQuestions: SCOPING_QUESTIONS.length,
      questions,
      skippedQuestions: session.skippedQuestions || [],
      isComplete: session.status === 'completed',
    };
  } catch (err) {
    console.warn(`[GrillMeWizard] getSessionState error: ${err.message}`);
    return null;
  }
}

// ─── Scoped Spec Generation ───────────────────────────────────────────────

/**
 * Generate enriched scope context from a completed session.
 * This feeds into the spec generators via the scopingAnswers parameter.
 *
 * Returns a structured object with:
 *   - scopingAnswers: raw answers keyed by question ID
 *   - scopingSummary: a concise text summary for spec headers
 *   - scopingContext: expanded context for each spec section
 *   - mvpScope: extracted MVP boundaries
 *
 * Returns null if session is not completed or on error.
 */
function generateScopeContext(projectPath, sessionId) {
  try {
    const session = loadSession(projectPath, sessionId);
    if (!session) return null;
    if (session.status !== 'completed') {
      console.warn(`[GrillMeWizard] generateScopeContext: session not completed (${session.status})`);
      return null;
    }

    const answers = session.answers || {};
    const skipped = session.skippedQuestions || [];

    // Build the scopingAnswers map
    const scopingAnswers = {};
    SCOPING_QUESTIONS.forEach((q) => {
      scopingAnswers[q.id] = {
        question: q.question,
        answer: answers[q.id] || null,
        skipped: skipped.includes(q.id),
      };
    });

    // Build a concise text summary
    const summaryParts = [];
    if (answers.problem) summaryParts.push(`Problem: ${answers.problem}`);
    if (answers.users) summaryParts.push(`Users: ${answers.users}`);
    if (answers.core_feature) summaryParts.push(`Core: ${answers.core_feature}`);
    if (answers.constraints) summaryParts.push(`Constraints: ${answers.constraints}`);
    if (answers.competition) summaryParts.push(`Differentiation: ${answers.competition}`);
    if (answers.success) summaryParts.push(`Success: ${answers.success}`);
    if (answers.mvp) summaryParts.push(`MVP: ${answers.mvp}`);

    const scopingSummary = summaryParts.join('\n');

    // Build expanded context for each spec section
    const scopingContext = {
      projectOverview: answers.problem
        ? `This project aims to solve: ${answers.problem}`
        : '',
      targetAudience: answers.users
        ? `Target users: ${answers.users}`
        : '',
      coreFunctionality: answers.core_feature
        ? `Core feature: ${answers.core_feature}`
        : '',
      constraints: answers.constraints
        ? `Constraints: ${answers.constraints}`
        : '',
      competitiveLandscape: answers.competition
        ? `Competition: ${answers.competition}`
        : '',
      successCriteria: answers.success
        ? `Success criteria: ${answers.success}`
        : '',
      mvpDefinition: answers.mvp
        ? `MVP scope: ${answers.mvp}`
        : '',
    };

    // Extract MVP boundaries for roadmap generation
    const mvpScope = {
      description: answers.mvp || null,
      coreFeature: answers.core_feature || null,
      successCriteria: answers.success || null,
    };

    return {
      scopingAnswers,
      scopingSummary,
      scopingContext,
      mvpScope,
    };
  } catch (err) {
    console.warn(`[GrillMeWizard] generateScopeContext error: ${err.message}`);
    return null;
  }
}

/**
 * Cancel a scoping session (user abandons the wizard midway).
 * Returns true on success, false on failure.
 */
function cancelSession(projectPath, sessionId) {
  try {
    const session = loadSession(projectPath, sessionId);
    if (!session) return false;

    session.status = 'cancelled';
    session.updatedAt = now();
    return saveSession(projectPath, session);
  } catch (err) {
    console.warn(`[GrillMeWizard] cancelSession error: ${err.message}`);
    return false;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────

module.exports = {
  // Constants
  SCOPING_QUESTIONS,
  QUESTION_IDS,

  // Session CRUD
  createSession,
  loadSession,
  saveSession,
  listSessions,
  deleteSession,
  cancelSession,

  // Answer management
  submitAnswer,
  skipQuestion,
  getCurrentQuestion,
  getSessionState,

  // Validation
  validateAnswer,

  // Scoped spec generation
  generateScopeContext,
};
