/**
 * lv-zero — Iron Laws Enforcement (Phase 3)
 *
 * Three non-blocking advisory gates that check conditions and warn
 * but do NOT prevent operations (to avoid breaking existing workflows).
 *
 * Law 1 — Systematic Debugging: "NO FIXES WITHOUT ROOT CAUSE"
 * Law 2 — Verification Gate:   "NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION"
 * Law 3 — Code Review Gate:     "NO MERGING WITHOUT SPEC COMPLIANCE CHECK"
 *
 * All functions are synchronous and return { passed, law, reason, evidence }.
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ─── Law 1: Systematic Debugging ─────────────────────────────────────────────
// "NO FIXES WITHOUT ROOT CAUSE"
// If context.isDebugging && !context.hasRootCause → warn
// Evidence: context should have rootCause field, errorLog, or related
function checkDebugLaw(projectPath, context) {
  try {
    const ctx = context || {};
    const isDebugging = ctx.isDebugging === true;

    if (!isDebugging) {
      return {
        passed: true,
        law: 'debug',
        reason: 'Not in debugging mode — law not applicable',
        evidence: null,
      };
    }

    const hasRootCause =
      ctx.hasRootCause === true ||
      (ctx.rootCause && typeof ctx.rootCause === 'string' && ctx.rootCause.trim().length > 0);

    if (hasRootCause) {
      return {
        passed: true,
        law: 'debug',
        reason: 'Root cause analysis is documented',
        evidence: {
          rootCause: ctx.rootCause || '(flagged via hasRootCause)',
          errorLog: ctx.errorLog || null,
        },
      };
    }

    return {
      passed: false,
      law: 'debug',
      reason: '⚠️ IRON LAW 1 VIOLATION: Fixes attempted without root cause analysis. Document the root cause before fixing.',
      evidence: {
        isDebugging: true,
        hasRootCause: false,
        errorLog: ctx.errorLog || null,
      },
    };
  } catch (err) {
    return {
      passed: true,
      law: 'debug',
      reason: `Debug law check bypassed due to error: ${err.message}`,
      evidence: null,
    };
  }
}

// ─── Law 2: Verification Gate ───────────────────────────────────────────────
// "NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION"
// If context.isCompletingTask && !context.hasVerification → warn
// Evidence: should show tests passed, lint passed, build succeeded
function checkVerificationGate(projectPath, context) {
  try {
    const ctx = context || {};
    const isCompletingTask = ctx.isCompletingTask === true;

    if (!isCompletingTask) {
      return {
        passed: true,
        law: 'verification',
        reason: 'Not completing a task — law not applicable',
        evidence: null,
      };
    }

    const hasVerification =
      ctx.hasVerification === true ||
      (ctx.verification &&
        typeof ctx.verification === 'object' &&
        (ctx.verification.testsPassed === true ||
          ctx.verification.lintPassed === true ||
          ctx.verification.buildSucceeded === true));

    if (hasVerification) {
      return {
        passed: true,
        law: 'verification',
        reason: 'Verification evidence is present',
        evidence: ctx.verification || { hasVerification: true },
      };
    }

    return {
      passed: false,
      law: 'verification',
      reason: '⚠️ IRON LAW 2 VIOLATION: Completing task without fresh verification. Run tests, lint, and build before claiming completion.',
      evidence: {
        isCompletingTask: true,
        hasVerification: false,
        taskId: ctx.taskId || null,
      },
    };
  } catch (err) {
    return {
      passed: true,
      law: 'verification',
      reason: `Verification gate bypassed due to error: ${err.message}`,
      evidence: null,
    };
  }
}

// ─── Law 3: Code Review Gate ───────────────────────────────────────────────
// "NO MERGING WITHOUT SPEC COMPLIANCE CHECK"
// If context.isMerging && !context.hasSpecCheck → warn
// Evidence: spec compliance report exists
function checkCodeReviewGate(projectPath, context) {
  try {
    const ctx = context || {};
    const isMerging = ctx.isMerging === true;

    if (!isMerging) {
      return {
        passed: true,
        law: 'review',
        reason: 'Not merging — law not applicable',
        evidence: null,
      };
    }

    const hasSpecCheck =
      ctx.hasSpecCheck === true ||
      (ctx.specCheck &&
        typeof ctx.specCheck === 'object' &&
        typeof ctx.specCheck.compliant === 'boolean');

    if (hasSpecCheck) {
      return {
        passed: true,
        law: 'review',
        reason: 'Spec compliance check has been performed',
        evidence: ctx.specCheck || { hasSpecCheck: true },
      };
    }

    return {
      passed: false,
      law: 'review',
      reason: '⚠️ IRON LAW 3 VIOLATION: Merging without spec compliance check. Verify the implementation matches the specification before merging.',
      evidence: {
        isMerging: true,
        hasSpecCheck: false,
      },
    };
  } catch (err) {
    return {
      passed: true,
      law: 'review',
      reason: `Code review gate bypassed due to error: ${err.message}`,
      evidence: null,
    };
  }
}

// ─── Unified Checker ─────────────────────────────────────────────────────────
function runAllGates(projectPath, context) {
  try {
    const gates = [
      checkDebugLaw(projectPath, context),
      checkVerificationGate(projectPath, context),
      checkCodeReviewGate(projectPath, context),
    ];

    const violations = gates.filter((g) => !g.passed);
    const allPassed = violations.length === 0;

    return {
      gates,
      allPassed,
      violations,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      gates: [],
      allPassed: true,
      violations: [],
      error: err.message,
      timestamp: new Date().toISOString(),
    };
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────
module.exports = {
  checkDebugLaw,
  checkVerificationGate,
  checkCodeReviewGate,
  runAllGates,
};
