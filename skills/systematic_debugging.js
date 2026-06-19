/**
 * systematic_debugging.js — Migrado de Antigravity systematic-debugging
 * Debugging en 4 fases: Root Cause → Pattern → Hypothesis → Implementation
 * Iron Law: NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
 */
export default {
  name: "systematic_debugging",
  description: "Systematic debugging in 4 phases. Enforces root cause investigation before any fix attempts. Auto-triggers on /debug, error detection, test failures. NO fixes without root cause first.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["start_debug", "phase_prompt", "escalation_check", "quick_ref"],
        description: '"start_debug": Inicia el proceso de debugging. "phase_prompt": Muestra prompt para una fase específica. "escalation_check": Verifica si se debe escalar (3+ fixes fallidos). "quick_ref": Referencia rápida de las 4 fases.'
      },
      phase: {
        type: "string",
        enum: ["1", "2", "3", "4"],
        description: "(phase_prompt) Fase a mostrar: 1=Root Cause, 2=Pattern, 3=Hypothesis, 4=Implementation."
      },
      errorDescription: {
        type: "string",
        description: "(start_debug) Descripción del error/problema."
      },
      failedAttempts: {
        type: "number",
        description: "(escalation_check) Número de intentos fallidos."
      },
      recentChanges: {
        type: "string",
        description: "(start_debug, opcional) Cambios recientes relevantes."
      }
    },
    required: ["action"]
  },
  handler: async (params) => {
    const { action, phase, errorDescription, failedAttempts, recentChanges } = params;

    if (action === "quick_ref") {
      return {
        success: true,
        phases: {
          "1": { name: "Root Cause", activities: "Read errors, reproduce, check changes, gather evidence", criteria: "Understand WHAT and WHY" },
          "2": { name: "Pattern", activities: "Find working examples, compare against references", criteria: "Identify every difference" },
          "3": { name: "Hypothesis", activities: "Form theory, test minimally (one variable at a time)", criteria: "Confirmed or new hypothesis" },
          "4": { name: "Implementation", activities: "Create failing test, implement fix, verify", criteria: "Bug resolved, tests pass" }
        },
        ironLaw: "NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST",
        escalationRule: "If 3+ fixes have FAILED → STOP. ESCALATE. This is NOT a failed hypothesis. This is a WRONG ARCHITECTURE."
      };
    }

    if (action === "escalation_check") {
      const attempts = failedAttempts || 0;
      if (attempts >= 3) {
        return {
          escalate: true,
          stop: true,
          message: `🚫 ESCALATION — 3+ fix attempts failed. This is likely an ARCHITECTURAL problem, not a bug. STOP and report to user:\n- What was tried\n- Why each failed\n- Architectural concern detected\n- Recommended: refactor approach | seek expert | alternative solution\n\nDO NOT attempt a 4th fix autonomously. WAIT for user decision.`,
          protocol: "STOP → REPORT → WAIT for user decision"
        };
      }
      return {
        escalate: false,
        remaining: 3 - attempts,
        message: `${attempts}/3 attempts used. ${3 - attempts} remaining before mandatory escalation.`
      };
    }

    if (action === "start_debug") {
      return {
        success: true,
        message: `🔧 SYSTEMATIC DEBUGGING ACTIVATED

⚠️ IRON LAW: NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST

📋 PHASE 1 — ROOT CAUSE (BEFORE ANY FIX):
1. Read error messages COMPLETELY — stack traces contain the answer
2. Reproduce consistently — exact steps to trigger
3. Check recent changes — git diff, commits, deps, config${recentChanges ? `\n   Context: ${recentChanges}` : ""}
4. Gather evidence at component boundaries — log input/output at each layer
5. Trace data flow — find the SOURCE, fix at source not symptom

${errorDescription ? `\n🔍 ERROR REPORTED: ${errorDescription}` : ""}

🚩 RED FLAGS — If you think:
- "Quick fix for now..." → STOP, return to Phase 1
- "It's probably X..." → STOP, gather evidence
- "One more fix attempt" (after 2+) → STOP, ESCALATE

Proceed to Phase 1 investigation. Use phase_prompt with phase='2', '3', or '4' when ready to advance.`,
        currentPhase: 1,
        redFlags: [
          "Quick fix for now, investigate later",
          "Just try changing X and see if it works",
          "It's probably X, let me fix that",
          "I don't fully understand but this might work",
          "One more fix attempt (when already tried 2+)"
        ]
      };
    }

    if (action === "phase_prompt") {
      const prompts = {
        "1": {
          title: "Phase 1: Root Cause Investigation",
          tasks: [
            "Read error messages and stack traces COMPLETELY",
            "Reproduce consistently — exact steps",
            "Check recent changes (git diff)",
            "Trace data flow from source to symptom",
            "Gather evidence at each component boundary"
          ],
          rule: "If you haven't completed ALL of these, you CANNOT propose fixes."
        },
        "2": {
          title: "Phase 2: Pattern Analysis",
          tasks: [
            "Find working examples in same codebase",
            "Compare against reference implementations",
            "List EVERY difference, however small",
            "Understand dependencies (components, config, settings)"
          ],
          rule: "Read reference implementation COMPLETELY — don't skim."
        },
        "3": {
          title: "Phase 3: Hypothesis & Testing",
          tasks: [
            "Form a SINGLE hypothesis: 'X is root cause because Y'",
            "Test MINIMALLY — one variable at a time",
            "Verify before continuing — worked? advance. didn't? NEW hypothesis",
            "If you don't know: say 'I don't understand X'. Research more."
          ],
          rule: "SMALLEST possible change. One variable at a time."
        },
        "4": {
          title: "Phase 4: Implementation",
          tasks: [
            "Create FAILING test case first — simplest reproduction",
            "Implement SINGLE fix — one change, no 'while I'm here'",
            "Verify: test passes? no other tests broken? issue resolved?"
          ],
          rule: "ONE fix at a time. No scope creep."
        }
      };

      const p = prompts[phase] || prompts["1"];
      return {
        success: true,
        phase: parseInt(phase),
        ...p,
        scopeFreeze: "During debug: NO fixing other bugs, NO refactoring, NO new features. Focus ONLY on current root cause."
      };
    }
  }
};
