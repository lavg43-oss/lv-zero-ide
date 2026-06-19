/**
 * lv-zero — Deploy Pipeline (CJS)
 *
 * Phase 6: Deploy Pipeline
 * Based on Antigravity `/deploy` v5.0 workflow:
 *   Pre-audit → Build → Smoke Test → Release → Rollback
 *
 * All functions are advisory / non-blocking — they never prevent normal operation.
 * Friday production protection is the only hard block.
 *
 * Deploy result structure:
 *   { status: "ok"|"blocked"|"warning"|"error", steps: [...], releaseId, timestamp }
 */

const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

// ─── Timer System (non-blocking load) ─────────────────────────────────────────

let timerSystem = null;
try {
  timerSystem = require("./timer-system.cjs");
} catch (err) {
  console.warn("[DeployPipeline] Timer system not available:", err.message);
}

// ─── Constants ───────────────────────────────────────────────────────────────

const LVDIR = ".lv-zero";
const RELEASES_DIR = path.join(LVDIR, "releases");
const SKIPPED_TESTS_FILE = path.join(LVDIR, "skipped-tests.json");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Ensure the releases directory exists.
 * @param {string} projectPath
 */
function ensureReleasesDir(projectPath) {
  const dir = path.join(projectPath, RELEASES_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get the current timestamp as an ISO string.
 */
function now() {
  return new Date().toISOString();
}

/**
 * Safe exec — returns stdout or empty string on failure.
 * @param {string} cmd
 * @param {string} cwd
 * @returns {string}
 */
function safeExec(cmd, cwd) {
  try {
    const timeout = timerSystem ? timerSystem.getCommandTimeout(cmd) : 30000;
    return execSync(cmd, { cwd, encoding: "utf-8", stdio: "pipe", timeout }).trim();
  } catch {
    return "";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: Pre-Audit
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run pre-deploy audit checks.
 * @param {string} projectPath
 * @returns {Object} { pass, warnings[], blocks[], details }
 */
function preAudit(projectPath) {
  const warnings = [];
  const blocks = [];
  const details = {};

  // 1a. Check for skipped tests
  try {
    const skippedPath = path.join(projectPath, SKIPPED_TESTS_FILE);
    if (fs.existsSync(skippedPath)) {
      const content = fs.readFileSync(skippedPath, "utf-8");
      const skipped = JSON.parse(content);
      if (Array.isArray(skipped) && skipped.length > 0) {
        warnings.push(`${skipped.length} test(s) skipped — review before deploy`);
        details.skippedTests = skipped;
      }
    }
  } catch {
    // File doesn't exist or is invalid — no problem
  }

  // 1b. Check for uncommitted changes
  try {
    const status = safeExec("git status --porcelain", projectPath);
    if (status) {
      const lines = status.split("\n").filter(Boolean);
      if (lines.length > 0) {
        warnings.push(`${lines.length} uncommitted change(s) — consider committing before deploy`);
        details.uncommittedCount = lines.length;
      }
    }
  } catch {
    warnings.push("Could not check git status — is this a git repository?");
  }

  // 1c. Check if it's Friday (production protection)
  const fridayBlock = isFridayProductionBlock();
  if (fridayBlock.blocked) {
    blocks.push(fridayBlock.message);
    details.fridayBlock = fridayBlock;
  }

  // 1d. Dependency audit (npm audit)
  try {
    const auditOut = safeExec("npm audit --json", projectPath);
    if (auditOut) {
      try {
        const audit = JSON.parse(auditOut);
        if (audit.vulnerabilities) {
          const total = Object.keys(audit.vulnerabilities).length;
          const critical = Object.values(audit.vulnerabilities).filter(
            (v) => v.severity === "critical"
          ).length;
          if (critical > 0) {
            warnings.push(`${critical} critical vulnerabilit(ies) found`);
          } else if (total > 0) {
            warnings.push(`${total} vulnerabilit(ies) found (none critical)`);
          }
          details.vulnerabilities = audit.vulnerabilities;
        }
      } catch {
        // audit JSON parse failed — non-critical
      }
    }
  } catch {
    // npm audit not available — non-critical
  }

  // 1e. Check critical tasks via symphony if available
  try {
    const symphonyPath = path.join(projectPath, LVDIR, "symphony", "tasks.json");
    if (fs.existsSync(symphonyPath)) {
      const tasks = JSON.parse(fs.readFileSync(symphonyPath, "utf-8"));
      if (Array.isArray(tasks)) {
        const criticalIncomplete = tasks.filter(
          (t) => t.priority === "critical" && t.status !== "done"
        );
        if (criticalIncomplete.length > 0) {
          warnings.push(
            `${criticalIncomplete.length} critical task(s) incomplete in Symphony`
          );
          details.criticalTasks = criticalIncomplete;
        }
      }
    }
  } catch {
    // Symphony not available — non-critical
  }

  return {
    pass: blocks.length === 0,
    warnings,
    blocks,
    details,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: Build
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect and run the build system for the project.
 * @param {string} projectPath
 * @param {Object} identity — project identity config (optional)
 * @returns {Object} { success, output, errors, buildCommand }
 */
function build(projectPath, identity) {
  const result = { success: false, output: "", errors: "", buildCommand: "" };

  // Detect build system
  let buildCmd = null;

  // Check package.json scripts
  const pkgPath = path.join(projectPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.scripts && pkg.scripts.build) {
        buildCmd = "npm run build";
      } else if (pkg.scripts && pkg.scripts["build:prod"]) {
        buildCmd = "npm run build:prod";
      }
    } catch {
      // invalid package.json
    }
  }

  // Check for other build systems
  if (!buildCmd) {
    if (fs.existsSync(path.join(projectPath, "Makefile"))) {
      buildCmd = "make";
    } else if (fs.existsSync(path.join(projectPath, "Dockerfile"))) {
      buildCmd = "docker build -t lv-zero-project .";
    } else if (fs.existsSync(path.join(projectPath, "setup.py"))) {
      buildCmd = "python setup.py build";
    } else if (fs.existsSync(path.join(projectPath, "Cargo.toml"))) {
      buildCmd = "cargo build";
    }
  }

  if (!buildCmd) {
    result.errors = "No build system detected (package.json build script, Makefile, Dockerfile, setup.py, Cargo.toml)";
    result.output = "Skipping build — no recognized build configuration found.";
    return result;
  }

  result.buildCommand = buildCmd;

  try {
    const timeout = timerSystem
      ? timerSystem.getCommandTimeout("build")
      : 120000;

    const output = execSync(buildCmd, {
      cwd: projectPath,
      encoding: "utf-8",
      stdio: "pipe",
      timeout,
    });
    result.success = true;
    result.output = output.trim();
  } catch (err) {
    result.success = false;
    result.output = err.stdout?.trim() || "";
    result.errors = err.stderr?.trim() || err.message;
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: Smoke Test
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run basic smoke tests on the project.
 * @param {string} projectPath
 * @returns {Object} { success, checks[] }
 */
function smokeTest(projectPath) {
  const checks = [];

  // 3a. Main entry file exists
  const entryPoints = ["index.js", "src/main.cjs", "src/index.js", "main.js", "app.js"];
  let mainExists = false;
  for (const entry of entryPoints) {
    if (fs.existsSync(path.join(projectPath, entry))) {
      mainExists = true;
      checks.push({ name: `Main entry (${entry})`, pass: true });
      break;
    }
  }
  if (!mainExists) {
    checks.push({ name: "Main entry file", pass: false, message: "No recognized entry point found" });
  }

  // 3b. Dependencies installed
  const nodeModulesPath = path.join(projectPath, "node_modules");
  if (fs.existsSync(nodeModulesPath)) {
    checks.push({ name: "Dependencies installed", pass: true });
  } else {
    checks.push({ name: "Dependencies installed", pass: false, message: "node_modules not found — run npm install" });
  }

  // 3c. Config files present
  const configFiles = [".env", "package.json"];
  for (const cf of configFiles) {
    if (fs.existsSync(path.join(projectPath, cf))) {
      checks.push({ name: `Config file (${cf})`, pass: true });
    } else {
      checks.push({ name: `Config file (${cf})`, pass: false, message: `${cf} not found` });
    }
  }

  // 3d. Syntax check on .js/.cjs files (up to first 10 files)
  try {
    const jsFiles = fs.readdirSync(projectPath).filter(
      (f) => f.endsWith(".js") || f.endsWith(".cjs")
    );
    const toCheck = jsFiles.slice(0, 10);
    for (const file of toCheck) {
      try {
        execSync(`node -c "${file}"`, {
          cwd: projectPath,
          encoding: "utf-8",
          stdio: "pipe",
          timeout: 10000,
        });
        checks.push({ name: `Syntax check (${file})`, pass: true });
      } catch (err) {
        checks.push({
          name: `Syntax check (${file})`,
          pass: false,
          message: err.stderr?.trim() || "Syntax error",
        });
      }
    }
  } catch {
    // skip if can't list directory
  }

  const allPass = checks.every((c) => c.pass);
  return { success: allPass, checks };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: Release
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate release notes from git log and save to .lv-zero/releases/.
 * @param {string} projectPath
 * @param {Object} buildResult
 * @returns {Object} { success, releaseId, releasePath, notes }
 */
function release(projectPath, buildResult) {
  const releasesDir = ensureReleasesDir(projectPath);
  const timestamp = Date.now();
  const releaseId = `release-${timestamp}`;

  // Get git log for release notes
  let gitLog = "";
  try {
    gitLog = safeExec("git log --oneline -20", projectPath);
  } catch {
    gitLog = "(no git history available)";
  }

  const notes = {
    releaseId,
    timestamp: now(),
    buildSuccess: buildResult?.success || false,
    buildCommand: buildResult?.buildCommand || "",
    gitLog: gitLog || "(empty)",
    message: `Release ${releaseId}`,
  };

  const releasePath = path.join(releasesDir, `${releaseId}.json`);
  try {
    fs.writeFileSync(releasePath, JSON.stringify(notes, null, 2), "utf-8");
    return { success: true, releaseId, releasePath, notes };
  } catch (err) {
    return { success: false, error: err.message, releaseId, notes };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5: Rollback Prep
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Prepare rollback information.
 * @param {string} projectPath
 * @returns {Object} { rollbackAvailable, strategy, currentCommit, previousCommit }
 */
function rollbackPrep(projectPath) {
  const result = {
    rollbackAvailable: false,
    strategy: "none",
    currentCommit: "",
    previousCommit: "",
  };

  try {
    const isRepo = safeExec("git rev-parse --git-dir", projectPath);
    if (!isRepo) {
      result.strategy = "backup";
      return result;
    }

    result.currentCommit = safeExec("git rev-parse HEAD", projectPath);

    // Get previous commit
    const prevCommit = safeExec("git rev-parse HEAD~1", projectPath);
    if (prevCommit) {
      result.previousCommit = prevCommit;
      result.rollbackAvailable = true;
      result.strategy = "git-revert";
    } else {
      result.strategy = "no-previous-commit";
    }
  } catch {
    result.strategy = "backup";
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Friday Production Block
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Global flag to enable/disable Friday block.
 * Can be toggled by external config.
 */
const GLOBAL_FRIDAY_BLOCK = {
  enabled: true,
};

/**
 * Check if it's Friday and production deploys should be blocked.
 * @returns {Object} { blocked, message }
 */
function isFridayProductionBlock() {
  if (!GLOBAL_FRIDAY_BLOCK.enabled) {
    return { blocked: false, message: "Friday block is disabled globally" };
  }

  const now = new Date();
  const day = now.getDay(); // 0=Sunday, 5=Friday
  const hour = now.getHours();
  const tzOffset = now.getTimezoneOffset();
  // Use local time (America/Mexico_City = UTC-6)
  const localHour = (hour - tzOffset / 60 + 24) % 24;

  if (day === 5 && localHour >= 14) {
    return {
      blocked: true,
      message:
        "🚫 Friday production block: It's Friday after 14:00 local time. " +
        "Production deploys are not allowed to prevent weekend incidents. " +
        "Use `force: true` to override.",
    };
  }

  return { blocked: false, message: "Not a Friday production block period" };
}

/**
 * Enable or disable the Friday production block globally.
 * @param {boolean} enabled
 */
function setFridayBlockEnabled(enabled) {
  GLOBAL_FRIDAY_BLOCK.enabled = enabled;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Full Pipeline Runner
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run the full deploy pipeline.
 * @param {string} projectPath
 * @param {Object} [options]
 * @param {boolean} [options.skipAudit] — Skip pre-audit step
 * @param {boolean} [options.skipBuild] — Skip build step
 * @param {boolean} [options.skipTests] — Skip smoke test step
 * @param {boolean} [options.force] — Override Friday production block
 * @returns {Object} Full deploy result
 */
function runDeployPipeline(projectPath, options = {}) {
  const steps = [];
  const startTime = Date.now();

  // Default options
  const skipAudit = options.skipAudit || false;
  const skipBuild = options.skipBuild || false;
  const skipTests = options.skipTests || false;
  const force = options.force || false;

  // ── Step 1: Pre-Audit ──
  if (!skipAudit) {
    try {
      const auditResult = preAudit(projectPath);
      steps.push({
        step: "pre-audit",
        status: auditResult.pass ? "ok" : "blocked",
        result: auditResult,
      });

      // Hard block: if pre-audit fails AND we're not forcing
      if (!auditResult.pass && !force) {
        return {
          status: "blocked",
          steps,
          releaseId: null,
          timestamp: now(),
          duration: Date.now() - startTime,
          message: "Pre-audit blocked the deployment. Use `force: true` to override.",
        };
      }
    } catch (err) {
      steps.push({ step: "pre-audit", status: "error", error: err.message });
      return {
        status: "error",
        steps,
        releaseId: null,
        timestamp: now(),
        duration: Date.now() - startTime,
        message: `Pre-audit failed: ${err.message}`,
      };
    }
  } else {
    steps.push({ step: "pre-audit", status: "skipped" });
  }

  // ── Step 2: Build ──
  let buildResult = null;
  if (!skipBuild) {
    try {
      buildResult = build(projectPath);
      steps.push({
        step: "build",
        status: buildResult.success ? "ok" : "error",
        result: buildResult,
      });

      if (!buildResult.success && !force) {
        return {
          status: "error",
          steps,
          releaseId: null,
          timestamp: now(),
          duration: Date.now() - startTime,
          message: `Build failed: ${buildResult.errors || "unknown error"}`,
        };
      }
    } catch (err) {
      steps.push({ step: "build", status: "error", error: err.message });
      return {
        status: "error",
        steps,
        releaseId: null,
        timestamp: now(),
        duration: Date.now() - startTime,
        message: `Build failed: ${err.message}`,
      };
    }
  } else {
    steps.push({ step: "build", status: "skipped" });
  }

  // ── Step 3: Smoke Test ──
  if (!skipTests) {
    try {
      const smokeResult = smokeTest(projectPath);
      steps.push({
        step: "smoke-test",
        status: smokeResult.success ? "ok" : "warning",
        result: smokeResult,
      });
    } catch (err) {
      steps.push({ step: "smoke-test", status: "error", error: err.message });
    }
  } else {
    steps.push({ step: "smoke-test", status: "skipped" });
  }

  // ── Step 4: Release ──
  let releaseResult = null;
  try {
    releaseResult = release(projectPath, buildResult);
    steps.push({
      step: "release",
      status: releaseResult.success ? "ok" : "error",
      result: releaseResult,
    });
  } catch (err) {
    steps.push({ step: "release", status: "error", error: err.message });
  }

  // ── Step 5: Rollback Prep ──
  try {
    const rollbackResult = rollbackPrep(projectPath);
    steps.push({
      step: "rollback-prep",
      status: "ok",
      result: rollbackResult,
    });
  } catch (err) {
    steps.push({ step: "rollback-prep", status: "error", error: err.message });
  }

  const allOk = steps.every((s) => s.status === "ok" || s.status === "skipped" || s.status === "warning");
  const hasWarnings = steps.some((s) => s.status === "warning");

  return {
    status: allOk ? "ok" : hasWarnings ? "warning" : "error",
    steps,
    releaseId: releaseResult?.releaseId || null,
    timestamp: now(),
    duration: Date.now() - startTime,
    message: allOk
      ? "Deploy pipeline completed successfully"
      : hasWarnings
        ? "Deploy pipeline completed with warnings"
        : "Deploy pipeline completed with errors",
  };
}

/**
 * List all releases for a project.
 * @param {string} projectPath
 * @returns {Object[]}
 */
function listReleases(projectPath) {
  const releasesDir = path.join(projectPath, RELEASES_DIR);
  if (!fs.existsSync(releasesDir)) {
    return [];
  }

  try {
    const files = fs.readdirSync(releasesDir).filter((f) => f.endsWith(".json"));
    return files
      .map((file) => {
        try {
          const content = fs.readFileSync(path.join(releasesDir, file), "utf-8");
          return JSON.parse(content);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  } catch {
    return [];
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  preAudit,
  build,
  smokeTest,
  release,
  rollbackPrep,
  isFridayProductionBlock,
  setFridayBlockEnabled,
  runDeployPipeline,
  listReleases,
};
