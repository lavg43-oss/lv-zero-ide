/**
 * lv-zero — Init Pipeline Orchestrator (Phase 4)
 *
 * Runs the spec-first init pipeline with optional scope interview:
 *   0. Scope Check — validate scoping answers from Grill Me wizard (optional)
 *   1. Environment Check — verify Node, npm, Git versions
 *   2. Context Awareness — scan existing project for structure
 *   3. Project Skeleton — ensure .lv-zero/ directories exist
 *   4. Spec Generation — call specGenerator.runSpecPipeline()
 *   5. Handover Report — return summary of what was created
 *
 * v1.1 — Scope-Enhanced Init Pipeline
 *   Non-blocking: each step wrapped in try/catch so failures don't cascade.
 *   scopingAnswers is optional — no scope interview, no change in behavior.
 */

const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const specGenerator = require("./spec-generator.cjs");

// ─── Step 0: Scope Check ─────────────────────────────────────────────────────

/**
 * Validate that scoping answers are present before spec generation.
 * This step runs only when scopingAnswers are provided (Grill Me wizard).
 * @param {object} scopingAnswers — Scoping answers from Grill Me wizard
 * @returns {{ name: string, ok: boolean, details: object }}
 */
function checkScope(scopingAnswers) {
  if (!scopingAnswers) {
    return {
      name: "scope",
      ok: true,
      details: { note: "No scoping answers provided — skipping scope validation", scoped: false },
    };
  }

  const requiredFields = ["problem", "users", "core_feature"];
  const missing = requiredFields.filter(f => !scopingAnswers[f]);
  const ok = missing.length === 0;

  return {
    name: "scope",
    ok,
    details: {
      scoped: true,
      missing: missing.length > 0 ? missing : undefined,
      fieldsPresent: Object.keys(scopingAnswers).length,
      note: ok
        ? "Scoping answers validated successfully"
        : `Missing required fields: ${missing.join(", ")}`,
    },
  };
}

// ─── Step 1: Environment Check ───────────────────────────────────────────────

/**
 * Check development environment tools and versions.
 * @returns {{ name: string, ok: boolean, checks: object }}
 */
function checkEnvironment() {
  const checks = {};

  // Node.js
  try {
    const nodeVersion = execSync("node --version", { encoding: "utf8", stdio: "pipe" }).trim();
    const major = parseInt(nodeVersion.replace(/v/g, "").split(".")[0], 10);
    checks.node = { ok: major >= 18, version: nodeVersion };
  } catch {
    checks.node = { ok: false, version: null, error: "Node.js not found" };
  }

  // npm
  try {
    const npmVersion = execSync("npm --version", { encoding: "utf8", stdio: "pipe" }).trim();
    const major = parseInt(npmVersion.split(".")[0], 10);
    checks.npm = { ok: major >= 8, version: npmVersion };
  } catch {
    checks.npm = { ok: false, version: null, error: "npm not found" };
  }

  // Git
  try {
    const gitVersion = execSync("git --version", { encoding: "utf8", stdio: "pipe" }).trim();
    checks.git = { ok: true, version: gitVersion };
  } catch {
    checks.git = { ok: false, version: null, error: "Git not found" };
  }

  // Python (optional)
  try {
    const pyVersion = execSync("python --version", { encoding: "utf8", stdio: "pipe" }).trim();
    const parts = pyVersion.replace(/Python /, "").split(".");
    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1], 10);
    checks.python = { ok: major >= 3 && minor >= 8, version: pyVersion, optional: true };
  } catch {
    checks.python = { ok: false, version: null, optional: true, error: "Python not found (optional)" };
  }

  const allOk = Object.values(checks).every(c => c.ok || c.optional);
  return { name: "environment", ok: allOk, checks };
}

// ─── Step 2: Context Awareness ───────────────────────────────────────────────

/**
 * Scan project directory to detect structure, languages, and frameworks.
 * @param {string} projectPath
 * @returns {{ name: string, ok: boolean, detected: object }}
 */
function analyzeContext(projectPath) {
  const detected = {
    hasPackageJson: false,
    hasRequirementsTxt: false,
    hasDockerfile: false,
    hasMakefile: false,
    hasGitignore: false,
    hasReadme: false,
    frameworks: [],
    languages: [],
    srcDirs: [],
  };

  try {
    // Check for common files
    detected.hasPackageJson = fs.existsSync(path.join(projectPath, "package.json"));
    detected.hasRequirementsTxt = fs.existsSync(path.join(projectPath, "requirements.txt"));
    detected.hasDockerfile = fs.existsSync(path.join(projectPath, "Dockerfile"));
    detected.hasMakefile = fs.existsSync(path.join(projectPath, "Makefile"));
    detected.hasGitignore = fs.existsSync(path.join(projectPath, ".gitignore"));
    detected.hasReadme = fs.existsSync(path.join(projectPath, "README.md"));

    // Detect frameworks from package.json
    if (detected.hasPackageJson) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, "package.json"), "utf8"));
        const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        const frameworkKeywords = ["electron", "express", "react", "vue", "angular", "next", "nuxt", "svelte", "remix", "gatsby"];
        for (const dep of Object.keys(allDeps)) {
          if (frameworkKeywords.some(kw => dep.includes(kw))) {
            detected.frameworks.push(dep);
          }
        }
        // Detect languages
        if (allDeps.typescript || allDeps["@types/node"]) {
          detected.languages.push("typescript");
        }
        if (allDeps.react || allDeps.vue || allDeps.angular) {
          if (!detected.languages.includes("javascript")) detected.languages.push("javascript");
        }
        if (allDeps.python || detected.hasRequirementsTxt) {
          if (!detected.languages.includes("python")) detected.languages.push("python");
        }
        if (Object.keys(allDeps).length > 0 && detected.languages.length === 0) {
          detected.languages.push("javascript");
        }
      } catch {
        // If package.json is malformed, continue with defaults
      }
    }

    // Detect source directories
    const commonSrcDirs = ["src", "lib", "app", "client", "server", "ui", "components"];
    for (const dir of commonSrcDirs) {
      if (fs.existsSync(path.join(projectPath, dir))) {
        detected.srcDirs.push(dir);
      }
    }

    return { name: "context", ok: true, detected };
  } catch (err) {
    return { name: "context", ok: false, error: err.message, detected };
  }
}

// ─── Step 3: Project Skeleton ────────────────────────────────────────────────

/**
 * Ensure the project has the required lv-zero directory structure.
 * @param {string} projectPath
 * @returns {{ name: string, ok: boolean, details: object }}
 */
function ensureSkeleton(projectPath) {
  const details = { created: [], existing: [], errors: [] };

  try {
    // .lv-zero directory
    const lvZeroDir = path.join(projectPath, ".lv-zero");
    if (!fs.existsSync(lvZeroDir)) {
      fs.mkdirSync(lvZeroDir, { recursive: true });
      details.created.push(".lv-zero/");
    } else {
      details.existing.push(".lv-zero/");
    }

    // mapa-del-proyecto directory
    const mapDir = path.join(projectPath, "mapa-del-proyecto");
    if (!fs.existsSync(mapDir)) {
      fs.mkdirSync(mapDir, { recursive: true });
      details.created.push("mapa-del-proyecto/");
      // Create a minimal README inside
      const projectName = path.basename(projectPath);
      fs.writeFileSync(
        path.join(mapDir, "README.md"),
        `# 🗺️ Mapa del Proyecto: ${projectName}\n\n` +
        `Generado automáticamente por lv-zero init pipeline.\n\n` +
        `Este directorio contiene metadatos del proyecto.\n` +
        `\n---\n*Creado: ${new Date().toISOString()}*\n`
      );
    } else {
      details.existing.push("mapa-del-proyecto/");
    }

    return { name: "skeleton", ok: true, details };
  } catch (err) {
    return { name: "skeleton", ok: false, error: err.message, details };
  }
}

// ─── Step 4: Spec Generation ─────────────────────────────────────────────────

/**
 * Generate spec files from project identity.
 * @param {string} projectPath
 * @param {object} identity
 * @param {object} [context]
 * @returns {{ name: string, ok: boolean, details: object }}
 */
function generateSpecs(projectPath, identity, context) {
  try {
    const result = specGenerator.runSpecPipeline(projectPath, identity, context);
    const ok = result.errors.length === 0;
    return {
      name: "spec",
      ok,
      details: {
        generated: result.generated,
        errors: result.errors,
        count: result.generated.length,
        total: 4,
      },
    };
  } catch (err) {
    return {
      name: "spec",
      ok: false,
      error: err.message,
      details: { generated: [], errors: [err.message], count: 0, total: 4 },
    };
  }
}

// ─── Step 4b: Spec Generation with Scope ─────────────────────────────────────

/**
 * Generate spec files from project identity with scoping answers.
 * When scopingAnswers is provided, passes it to specGenerator for enriched output.
 * @param {string} projectPath
 * @param {object} identity
 * @param {object} [context]
 * @param {object} [scopingAnswers] — Optional scoping answers from Grill Me wizard
 * @returns {{ name: string, ok: boolean, details: object }}
 */
function generateSpecsWithScope(projectPath, identity, context, scopingAnswers) {
  try {
    const result = specGenerator.runSpecPipeline(projectPath, identity, context, scopingAnswers);
    const ok = result.errors.length === 0;
    return {
      name: "spec",
      ok,
      details: {
        generated: result.generated,
        errors: result.errors,
        count: result.generated.length,
        total: 4,
        scoped: !!scopingAnswers,
      },
    };
  } catch (err) {
    return {
      name: "spec",
      ok: false,
      error: err.message,
      details: { generated: [], errors: [err.message], count: 0, total: 4, scoped: !!scopingAnswers },
    };
  }
}

// ─── Step 5: Handover Report ─────────────────────────────────────────────────

/**
 * Generate a handover report summarizing pipeline results.
 * @param {Array} steps — Array of step results
 * @returns {{ name: string, ok: boolean, details: object }}
 */
function generateHandover(steps) {
  const okSteps = steps.filter(s => s.ok);
  const failSteps = steps.filter(s => !s.ok);
  const specStep = steps.find(s => s.name === "spec");
  const generated = specStep?.details?.generated || [];

  const nextSteps = [
    "Review and customize PROJECT.md with your project vision",
    "Fill in specific requirements in REQUIREMENTS.md",
    "Adjust milestones in ROADMAP.md to match your timeline",
    "Refine TECH-SPEC.md with detailed architecture decisions",
  ];

  return {
    name: "handover",
    ok: true,
    details: {
      generated,
      skipped: failSteps.map(s => s.name),
      errors: failSteps.map(s => s.error).filter(Boolean),
      summary: `${okSteps.length}/${steps.length} steps completed successfully`,
      nextSteps,
    },
  };
}

// ─── Full Pipeline ───────────────────────────────────────────────────────────

/**
 * Run the complete 5-step init pipeline.
 * Each step is wrapped in try/catch — failures don't cascade.
 *
 * @param {string} projectPath — Path to the project
 * @param {object} identity — Project identity config (from project-identity.cjs)
 * @returns {{ status: string, steps: Array }}
 */
function runInitPipeline(projectPath, identity) {
  const steps = [];

  // Step 1: Environment Check
  try {
    steps.push(checkEnvironment());
  } catch (err) {
    steps.push({ name: "environment", ok: false, error: err.message });
  }

  // Step 2: Context Awareness
  let context = null;
  try {
    const ctxResult = analyzeContext(projectPath);
    steps.push(ctxResult);
    if (ctxResult.ok) {
      context = ctxResult.detected;
    }
  } catch (err) {
    steps.push({ name: "context", ok: false, error: err.message });
  }

  // Step 3: Project Skeleton
  try {
    steps.push(ensureSkeleton(projectPath));
  } catch (err) {
    steps.push({ name: "skeleton", ok: false, error: err.message });
  }

  // Step 4: Spec Generation
  try {
    steps.push(generateSpecs(projectPath, identity, context));
  } catch (err) {
    steps.push({ name: "spec", ok: false, error: err.message });
  }

  // Step 5: Handover Report
  try {
    steps.push(generateHandover(steps));
  } catch (err) {
    steps.push({ name: "handover", ok: false, error: err.message });
  }

  const okCount = steps.filter(s => s.ok).length;
  const status = okCount === steps.length ? "ok" : okCount > 0 ? "partial" : "failed";

  return { status, steps };
}

// ─── Scoped Pipeline ─────────────────────────────────────────────────────────

/**
 * Run the complete init pipeline with an optional scope interview step.
 * Step 0 validates scoping answers from Grill Me wizard before proceeding.
 * When scopingAnswers is provided, spec generation is enriched with scoped data.
 * When absent, this behaves identically to runInitPipeline().
 *
 * @param {string} projectPath — Path to the project
 * @param {object} identity — Project identity config
 * @param {object} [scopingAnswers] — Optional scoping answers from Grill Me wizard
 * @returns {{ status: string, steps: Array }}
 */
function runInitPipelineWithScope(projectPath, identity, scopingAnswers) {
  const steps = [];

  // Step 0: Scope Check (only runs when scopingAnswers is provided)
  try {
    steps.push(checkScope(scopingAnswers));
  } catch (err) {
    steps.push({ name: "scope", ok: false, error: err.message });
  }

  // Step 1: Environment Check
  try {
    steps.push(checkEnvironment());
  } catch (err) {
    steps.push({ name: "environment", ok: false, error: err.message });
  }

  // Step 2: Context Awareness
  let context = null;
  try {
    const ctxResult = analyzeContext(projectPath);
    steps.push(ctxResult);
    if (ctxResult.ok) {
      context = ctxResult.detected;
    }
  } catch (err) {
    steps.push({ name: "context", ok: false, error: err.message });
  }

  // Step 3: Project Skeleton
  try {
    steps.push(ensureSkeleton(projectPath));
  } catch (err) {
    steps.push({ name: "skeleton", ok: false, error: err.message });
  }

  // Step 4: Spec Generation (with scoping answers if available)
  try {
    steps.push(generateSpecsWithScope(projectPath, identity, context, scopingAnswers));
  } catch (err) {
    steps.push({ name: "spec", ok: false, error: err.message });
  }

  // Step 5: Handover Report
  try {
    steps.push(generateHandover(steps));
  } catch (err) {
    steps.push({ name: "handover", ok: false, error: err.message });
  }

  const okCount = steps.filter(s => s.ok).length;
  const status = okCount === steps.length ? "ok" : okCount > 0 ? "partial" : "failed";

  return { status, steps };
}

// ─── Status Check ────────────────────────────────────────────────────────────

/**
 * Get the init status for a project — checks which spec files exist.
 * @param {string} projectPath
 * @returns {{ complete: boolean, steps: Array }}
 */
function getInitStatus(projectPath) {
  const specStatus = specGenerator.getSpecStatus(projectPath);
  const steps = [
    { name: "environment", ok: true, note: "Checked at pipeline run time" },
    { name: "context", ok: true, note: "Checked at pipeline run time" },
    { name: "skeleton", ok: fs.existsSync(path.join(projectPath, ".lv-zero")), note: ".lv-zero/ exists" },
    { name: "spec", ok: specStatus.complete, note: `${specStatus.existing.length}/4 spec files present` },
    { name: "handover", ok: specStatus.complete, note: "Handover is valid when specs are complete" },
  ];

  return {
    complete: specStatus.complete,
    steps,
    specStatus,
  };
}

module.exports = {
  checkScope,
  checkEnvironment,
  analyzeContext,
  ensureSkeleton,
  generateSpecs,
  generateSpecsWithScope,
  generateHandover,
  runInitPipeline,
  runInitPipelineWithScope,
  getInitStatus,
};
