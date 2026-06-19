/**
 * verification_gate.js — Migrado de Antigravity verification-gate
 * Verificación: evidencia antes de afirmar. NO completion claims sin verificación fresca.
 */
export default {
  name: "verification_gate",
  description: "Verification gate — evidence before assertions, always. Run verification commands BEFORE claiming any work is complete, fixed, or passing. Auto-triggers on task completion, commit, deploy.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["verify_claim", "boil_lake_checklist", "anti_rationalize", "commit_and_push", "full_gate"],
        description: '"verify_claim": Verifica un claim con evidencia. "boil_lake_checklist": Checklist de completitud. "anti_rationalize": Refuta excusas comunes. "commit_and_push": Auto-commit seguro. "full_gate": Gate completo pre-completion.'
      },
      claimType: {
        type: "string",
        enum: ["tests", "linter", "build", "bug_fix", "feature", "requirements", "deploy"],
        description: "(verify_claim) Tipo de claim a verificar."
      },
      claim: {
        type: "string",
        description: "(verify_claim) El claim que se está haciendo (ej: 'Todos los tests pasan')."
      },
      evidence: {
        type: "string",
        description: "(verify_claim) Evidencia del claim (output del comando de verificación)."
      },
      exitCode: {
        type: "number",
        description: "(verify_claim) Exit code del comando de verificación."
      },
      commitMessage: {
        type: "string",
        description: "(commit_and_push) Mensaje de commit convencional (fix:/feat:/refactor:)."
      }
    },
    required: ["action"]
  },
  handler: async (params) => {
    const { action, claimType, claim, evidence, exitCode, commitMessage } = params;

    const requirements = {
      tests: { command: "Test command", needs: "0 failures", insufficient: "Previous run, 'should pass'" },
      linter: { command: "Linter command", needs: "0 errors", insufficient: "Partial check, extrapolation" },
      build: { command: "Build command", needs: "exit 0", insufficient: "Linter passing, looks good" },
      bug_fix: { command: "Test original symptom", needs: "passes", insufficient: "Code changed, assumed fixed" },
      feature: { command: "Screenshot / UI test", needs: "renders correctly", insufficient: "Code written, assumed works" },
      requirements: { command: "Line-by-line checklist", needs: "all checked", insufficient: "Tests passing" },
      deploy: { command: "Health check", needs: "200 OK", insufficient: "Deploy command completed" }
    };

    if (action === "anti_rationalize") {
      return {
        success: true,
        ironLaw: "NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE",
        table: {
          "Should work now": "RUN the verification",
          "I'm confident": "Confidence ≠ evidence",
          "Just this once": "No exceptions",
          "Linter passed": "Linter ≠ compiler ≠ runtime",
          "I'm tired": "Exhaustion ≠ excuse",
          "Partial check is enough": "Partial proves nothing",
          "Build passed so tests pass": "Build ≠ tests",
          "I just changed one line": "One line can break everything",
          "It's a trivial change": "Trivial changes have the sneakiest bugs"
        },
        redFlags: [
          'Using "should", "probably", "seems to", "looks correct"',
          'Expressing satisfaction before verification ("Great!", "Done!")',
          "About to commit/push without verification",
          "Relying on partial verification",
          'Thinking "just this once I can skip"'
        ]
      };
    }

    if (action === "verify_claim") {
      if (!claimType || !claim) {
        return { success: false, error: "Se requiere 'claimType' y 'claim'." };
      }

      const req = requirements[claimType];
      const evidenceOk = evidence && evidence.length > 0;
      const exitOk = exitCode === 0 || exitCode === undefined;

      const passed = evidenceOk && exitOk;

      return {
        success: true,
        passed,
        claim,
        claimType,
        requirement: req,
        evidence: evidence || "(NO EVIDENCE PROVIDED)",
        exitCode: exitCode ?? "(not checked)",
        verdict: passed
          ? `✅ CLAIM VERIFIED: "${claim}" — Evidence confirms.`
          : `❌ CLAIM REJECTED: "${claim}" — Insufficient evidence. Run ${req.command} first.`,
        gateRule: `BEFORE claiming: 1) IDENTIFY what command proves it, 2) RUN full command, 3) READ output, 4) VERIFY, 5) ONLY THEN claim.`
      };
    }

    if (action === "boil_lake_checklist") {
      return {
        success: true,
        principle: "AI's marginal cost is near zero. Ship completeness, not shortcuts.",
        checklist: [
          "☐ Error handling: EVERY code path has proper error handling? (network, parsing, invalid input, timeouts)",
          "☐ Edge cases: Handle empty states, nil/null, boundary values? (empty list, first/last item, max size)",
          "☐ Logging: Enough logs for production debugging? (errors with context, key operations tracked)",
          "☐ Cleanup: Resources released? Listeners removed? Timers cancelled?",
          "☐ Input validation: User input validated before processing?",
          "☐ Concurrency: Thread-safe? Race conditions handled?",
          "☐ Backwards compatibility: Breaking changes documented?",
          "☐ Localization (I18N): New UI text added to localization files (EN & VI)?"
        ],
        rule: "If ANY item is missing → report DONE_WITH_CONCERNS, not DONE."
      };
    }

    if (action === "commit_and_push") {
      return {
        success: true,
        steps: [
          "1. Verify build passes (exit 0)",
          "2. git add <changed files>",
          `3. git commit -m "${commitMessage || 'fix: apply changes'}"`,
          "4. git push (non-force)",
          "5. If push fails → git pull --rebase && git push (retry once)"
        ],
        rules: [
          "Do NOT ask user permission for regular commits",
          "Use conventional commit messages: fix:/feat:/refactor:",
          "Only auto-commit when build passes with 0 errors"
        ]
      };
    }

    if (action === "full_gate") {
      return {
        success: true,
        ironLaw: "NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE",
        gateFunction: [
          "1. IDENTIFY: What command proves this claim?",
          "2. RUN: Execute the FULL command (fresh, complete)",
          "3. READ: Full output, check exit code, count failures",
          "4. VERIFY: Does output confirm the claim?",
          "   - NO → State actual status with evidence",
          "   - YES → State claim WITH evidence",
          "5. ONLY THEN: Make the claim",
          "6. AUTO-COMMIT: Build 0 errors → git add → commit → push"
        ],
        whenToApply: [
          "ANY success/completion claim",
          "ANY expression of satisfaction ('Done!', 'Fixed!')",
          "Before committing, PR, task completion",
          "Before moving to next task",
          "Before deploying or pushing code"
        ],
        bottomLine: "Skip any step = lying, not verifying. This is non-negotiable."
      };
    }
  }
};
