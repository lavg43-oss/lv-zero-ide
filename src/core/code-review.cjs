/**
 * Phase 5: Code Review Pipeline
 * Two-stage code review system: Spec Compliance → Code Quality
 * Inspired by Antigravity's Codex CLI approach.
 *
 * Reports are saved to .lv-zero/codex-reports/*.md
 *
 * Non-blocking — review is advisory only (no auto-fix, no auto-reject).
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ─── Timer System (non-blocking load) ─────────────────────────────────────────

let timerSystem = null;
try {
  timerSystem = require("./timer-system.cjs");
} catch (err) {
  console.warn("[CodeReview] Timer system not available:", err.message);
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const REPORTS_DIR_NAME = "codex-reports";
const MAX_LINE_LENGTH = 120;
const MAX_NESTING_DEPTH = 4;
const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1 MB — skip binary/large files

// ────────────────────────────────────────────────────────────────────────────
// Spec Compliance (Stage 1)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Check if a file matches the project spec (spec/*.md in project root).
 * @param {string} filePath - Absolute path to the file being reviewed.
 * @param {string} projectPath - Absolute path to the project root.
 * @returns {Array<{line: number, severity: string, message: string}>}
 */
function checkSpecCompliance(filePath, projectPath) {
  const findings = [];

  try {
    const specDir = path.join(projectPath, "spec");
    if (!fs.existsSync(specDir)) {
      findings.push({
        line: 0,
        severity: "info",
        message: "No spec/ directory found — skipping spec compliance check",
      });
      return findings;
    }

    // Read all spec files
    const specFiles = fs.readdirSync(specDir).filter((f) => f.endsWith(".md"));

    if (specFiles.length === 0) {
      findings.push({
        line: 0,
        severity: "info",
        message: "No .md files in spec/ — skipping spec compliance check",
      });
      return findings;
    }

    // Read file content
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // ── Spec Content Check ──────────────────────────────────────────────
    for (const specFile of specFiles) {
      const specContent = fs.readFileSync(path.join(specDir, specFile), "utf-8");

      // Check if spec mentions this file type or name
      const mentionsFile =
        specContent.toLowerCase().includes(fileName.toLowerCase()) ||
        specContent.toLowerCase().includes(`.${ext}`);

      if (!mentionsFile) continue;

      // Extract key requirements from spec (lines starting with - or ###)
      const requirements = specContent
        .split("\n")
        .filter(
          (l) =>
            l.trim().startsWith("-") ||
            l.trim().startsWith("*") ||
            l.trim().startsWith("###")
        )
        .map((l) => l.trim());

      for (const req of requirements) {
        const cleanReq = req.replace(/^[-*#]\s*/, "").toLowerCase();
        const foundInFile = lines.some((line) =>
          line.toLowerCase().includes(cleanReq.substring(0, 40))
        );

        if (!foundInFile && cleanReq.length > 10) {
          findings.push({
            line: 0,
            severity: "warning",
            message: `Spec requirement possibly unmet: "${cleanReq.substring(0, 60)}..."`,
          });
        }
      }
    }
  } catch (err) {
    findings.push({
      line: 0,
      severity: "error",
      message: `Spec compliance check error: ${err.message}`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      line: 0,
      severity: "info",
      message: "All spec compliance checks passed",
    });
  }

  return findings;
}

// ────────────────────────────────────────────────────────────────────────────
// Code Quality (Stage 2)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Check code quality heuristics for a file.
 * @param {string} filePath - Absolute path to the file.
 * @param {string} content - File content (pre-read, optional).
 * @returns {Array<{line: number, severity: string, message: string}>}
 */
function checkCodeQuality(filePath, content) {
  const findings = [];

  try {
    if (!content) {
      content = fs.readFileSync(filePath, "utf-8");
    }
  } catch (err) {
    findings.push({
      line: 0,
      severity: "error",
      message: `Cannot read file: ${err.message}`,
    });
    return findings;
  }

  const lines = content.split("\n");
  const ext = path.extname(filePath).toLowerCase();

  // ── 1. Empty file check ───────────────────────────────────────────────
  if (lines.length === 0 || (lines.length === 1 && lines[0].trim() === "")) {
    findings.push({
      line: 0,
      severity: "critical",
      message: "File is empty",
    });
    return findings;
  }

  // ── 2. Line length check ──────────────────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > MAX_LINE_LENGTH) {
      findings.push({
        line: i + 1,
        severity: "warning",
        message: `Line exceeds ${MAX_LINE_LENGTH} characters (${lines[i].length})`,
      });
    }
  }

  // ── 3. Missing error handling (JS/TS) ─────────────────────────────────
  if ([".js", ".jsx", ".ts", ".tsx", ".cjs", ".mjs"].includes(ext)) {
    // Check for functions that use callbacks/async but lack try/catch
    const asyncPatterns = [
      /async\s+function/,
      /\.then\s*\(/,
      /await\s+/,
      /fs\.\w+/,
    ];
    const hasAsyncCode = asyncPatterns.some((p) => p.test(content));
    const hasTryCatch = /\btry\b/.test(content) && /\bcatch\b/.test(content);

    if (hasAsyncCode && !hasTryCatch) {
      findings.push({
        line: 0,
        severity: "warning",
        message:
          "File uses async patterns but has no try/catch — consider wrapping in error handling",
      });
    }

    // Check for console.log (informational)
    const consoleLogMatches = content.match(/console\.log\s*\(/g);
    if (consoleLogMatches && consoleLogMatches.length > 2) {
      findings.push({
        line: 0,
        severity: "info",
        message: `Found ${consoleLogMatches.length} console.log() calls — consider removing before production`,
      });
    }
  }

  // ── 4. TODO/FIXME detection ───────────────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/\/\/\s*(TODO|FIXME|HACK|XXX)/i.test(trimmed) || /\/\*\s*(TODO|FIXME|HACK|XXX)/i.test(trimmed)) {
      const match = trimmed.match(/(TODO|FIXME|HACK|XXX)/i);
      findings.push({
        line: i + 1,
        severity: "info",
        message: `${match[0]} found: "${trimmed.replace(/^.*?\/[/\*]\s*(TODO|FIXME|HACK|XXX)\s*/i, "").substring(0, 60)}"`,
      });
    }
  }

  // ── 5. Deep nesting check (braces-based) ──────────────────────────────
  if ([".js", ".jsx", ".ts", ".tsx", ".cjs", ".mjs", ".html", ".css"].includes(ext)) {
    let maxDepth = 0;
    let currentDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Count opening braces
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;

      currentDepth += opens - closes;
      maxDepth = Math.max(maxDepth, currentDepth);
    }

    if (maxDepth > MAX_NESTING_DEPTH) {
      findings.push({
        line: 0,
        severity: "warning",
        message: `Deep nesting detected: max depth ${maxDepth} (recommended ≤ ${MAX_NESTING_DEPTH})`,
      });
    }
  }

  // ── 6. File size check ────────────────────────────────────────────────
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      findings.push({
        line: 0,
        severity: "warning",
        message: `Large file: ${(stat.size / 1024).toFixed(1)} KB — consider splitting into smaller modules`,
      });
    }
  } catch {
    // ignore stat errors
  }

  if (findings.length === 0) {
    findings.push({
      line: 0,
      severity: "info",
      message: "All quality checks passed",
    });
  }

  return findings;
}

// ────────────────────────────────────────────────────────────────────────────
// Full Review (Stage 1 + Stage 2)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Run full two-stage review on a single file.
 * @param {string} filePath - Absolute path to the file.
 * @param {string} projectPath - Absolute path to the project root.
 * @returns {object} Review result with scores and findings.
 */
function reviewFile(filePath, projectPath) {
  const result = {
    filePath,
    fileName: path.basename(filePath),
    timestamp: new Date().toISOString(),
    specCompliance: [],
    codeQuality: [],
    score: 100,
    summary: "",
  };

  try {
    // Determine timeout based on file size
    const reviewTimeout = timerSystem
      ? (() => {
          try {
            const stat = fs.statSync(filePath);
            // Files > 100KB use deep review timeout, else quick
            return stat.size > 100 * 1024
              ? timerSystem.getTimeout("code-review-deep")
              : timerSystem.getTimeout("code-review-quick");
          } catch {
            return timerSystem.getTimeout("code-review-quick");
          }
        })()
      : 0;

    // Wrap the entire review in a timeout if timer system is available
    if (timerSystem && timerSystem.withTimeout && reviewTimeout > 0) {
      return timerSystem.withTimeout(
        (() => {
          // Verify file exists
          if (!fs.existsSync(filePath)) {
            result.summary = "File does not exist";
            result.score = 0;
            return result;
          }

          // Stage 1: Spec Compliance
          result.specCompliance = checkSpecCompliance(filePath, projectPath);

          // Stage 2: Code Quality
          const content = fs.readFileSync(filePath, "utf-8");
          result.codeQuality = checkCodeQuality(filePath, content);

          // Calculate score
          let deductions = 0;
          const allFindings = [...result.specCompliance, ...result.codeQuality];
          for (const finding of allFindings) {
            switch (finding.severity) {
              case "critical": deductions += 30; break;
              case "error": deductions += 15; break;
              case "warning": deductions += 5; break;
              case "info": deductions += 0; break;
            }
          }
          result.score = Math.max(0, Math.min(100, 100 - deductions));

          // Generate summary
          const criticals = allFindings.filter((f) => f.severity === "critical").length;
          const errors = allFindings.filter((f) => f.severity === "error").length;
          const warnings = allFindings.filter((f) => f.severity === "warning").length;
          const infos = allFindings.filter((f) => f.severity === "info").length;
          result.summary = `${result.fileName}: score=${result.score}/100 (${criticals} critical, ${errors} error, ${warnings} warning, ${infos} info)`;

          return result;
        })(),
        reviewTimeout,
        `Code review: ${path.basename(filePath)}`
      );
    }

    // Fallback: no timer system — run review directly
    // Verify file exists
    if (!fs.existsSync(filePath)) {
      result.summary = "File does not exist";
      result.score = 0;
      return result;
    }

    // Stage 1: Spec Compliance
    result.specCompliance = checkSpecCompliance(filePath, projectPath);

    // Stage 2: Code Quality
    const content = fs.readFileSync(filePath, "utf-8");
    result.codeQuality = checkCodeQuality(filePath, content);

    // Calculate score
    let deductions = 0;
    const allFindings = [...result.specCompliance, ...result.codeQuality];
    for (const finding of allFindings) {
      switch (finding.severity) {
        case "critical": deductions += 30; break;
        case "error": deductions += 15; break;
        case "warning": deductions += 5; break;
        case "info": deductions += 0; break;
      }
    }
    result.score = Math.max(0, Math.min(100, 100 - deductions));

    // Generate summary
    const criticals = allFindings.filter((f) => f.severity === "critical").length;
    const errors = allFindings.filter((f) => f.severity === "error").length;
    const warnings = allFindings.filter((f) => f.severity === "warning").length;
    const infos = allFindings.filter((f) => f.severity === "info").length;
    result.summary = `${result.fileName}: score=${result.score}/100 (${criticals} critical, ${errors} error, ${warnings} warning, ${infos} info)`;
  } catch (err) {
    if (err.code === "TIMEOUT") {
      result.summary = `[TIMEOUT] Code review timed out: ${path.basename(filePath)}`;
    } else {
      result.summary = `Review error: ${err.message}`;
    }
    result.score = 0;
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Review All Changed Files
// ────────────────────────────────────────────────────────────────────────────

/**
 * Review all changed files in a project (git-tracked changes).
 * Falls back to common source directories if git is unavailable.
 * @param {string} projectPath - Absolute path to the project root.
 * @returns {Array<object>} Array of review results.
 */
function reviewAllChanged(projectPath) {
  const results = [];

  try {
    let changedFiles = [];

    // Try git first
    try {
      const gitDir = execSync("git rev-parse --git-dir", {
        cwd: projectPath,
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();

      if (gitDir) {
        // Get changed files (modified, unstaged, untracked)
        const statusOut = execSync(
          "git status --porcelain",
          { cwd: projectPath, encoding: "utf-8", stdio: "pipe" }
        );
        const statusLines = statusOut
          .trim()
          .split("\n")
          .filter(Boolean);

        for (const line of statusLines) {
          const filePath = line.substring(3).trim();
          if (filePath) {
            const absPath = path.resolve(projectPath, filePath);
            if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
              changedFiles.push(absPath);
            }
          }
        }
      }
    } catch {
      // Not a git repo — fallback to common source directories
      const srcDirs = ["src", "ui", "lib", "app", "components"];
      for (const dir of srcDirs) {
        const absDir = path.join(projectPath, dir);
        if (fs.existsSync(absDir)) {
          try {
            const entries = fs.readdirSync(absDir, { recursive: true });
            for (const entry of entries) {
              const absPath = path.resolve(absDir, entry);
              try {
                if (fs.statSync(absPath).isFile()) {
                  changedFiles.push(absPath);
                }
              } catch {
                // skip stat errors
              }
            }
          } catch {
            // skip read errors
          }
        }
      }
    }

    // Limit to reasonable number
    if (changedFiles.length > 50) {
      changedFiles = changedFiles.slice(0, 50);
    }

    // Review each file
    for (const filePath of changedFiles) {
      try {
        const result = reviewFile(filePath, projectPath);
        results.push(result);
      } catch (err) {
        results.push({
          filePath,
          fileName: path.basename(filePath),
          timestamp: new Date().toISOString(),
          specCompliance: [],
          codeQuality: [],
          score: 0,
          summary: `Review error: ${err.message}`,
        });
      }
    }
  } catch (err) {
    // If everything fails, return empty results with error
  }

  return results;
}

// ────────────────────────────────────────────────────────────────────────────
// Report Generation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generate a markdown report from review result(s).
 * @param {object|Array<object>} report - Single or array of review results.
 * @returns {string} Markdown content.
 */
function generateReportMd(report) {
  const results = Array.isArray(report) ? report : [report];
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  let md = `# 📋 Code Review Report\n\n`;
  md += `**Generated:** ${dateStr}\n`;
  md += `**Files reviewed:** ${results.length}\n\n`;

  // Summary table
  md += `## Summary\n\n`;
  md += `| File | Score | Critical | Error | Warning | Info |\n`;
  md += `|------|-------|----------|-------|---------|------|\n`;

  for (const r of results) {
    const allFindings = [...(r.specCompliance || []), ...(r.codeQuality || [])];
    const criticals = allFindings.filter((f) => f.severity === "critical").length;
    const errors = allFindings.filter((f) => f.severity === "error").length;
    const warnings = allFindings.filter((f) => f.severity === "warning").length;
    const infos = allFindings.filter((f) => f.severity === "info").length;
    const scoreEmoji = r.score >= 80 ? "🟢" : r.score >= 50 ? "🟡" : "🔴";

    md += `| ${r.fileName} | ${scoreEmoji} ${r.score}/100 | ${criticals} | ${errors} | ${warnings} | ${infos} |\n`;
  }

  // Detailed findings
  md += `\n## Detailed Findings\n\n`;

  for (const r of results) {
    md += `### ${r.fileName}\n\n`;
    md += `**Path:** \`${r.filePath}\`\n`;
    md += `**Score:** ${r.score}/100\n`;
    md += `**Summary:** ${r.summary}\n\n`;

    const allFindings = [...(r.specCompliance || []), ...(r.codeQuality || [])];

    if (allFindings.length === 0) {
      md += `_No issues found._\n\n`;
      continue;
    }

    // Group by severity
    const grouped = { critical: [], error: [], warning: [], info: [] };
    for (const f of allFindings) {
      if (grouped[f.severity]) {
        grouped[f.severity].push(f);
      }
    }

    for (const [severity, items] of Object.entries(grouped)) {
      if (items.length === 0) continue;

      const severityLabels = {
        critical: "🔴 Critical",
        error: "🟠 Error",
        warning: "🟡 Warning",
        info: "🔵 Info",
      };

      md += `#### ${severityLabels[severity] || severity}\n\n`;
      for (const item of items) {
        const lineInfo = item.line > 0 ? ` (line ${item.line})` : "";
        md += `- ${item.message}${lineInfo}\n`;
      }
      md += "\n";
    }
  }

  return md;
}

// ────────────────────────────────────────────────────────────────────────────
// Reports Listing
// ────────────────────────────────────────────────────────────────────────────

/**
 * List existing code review reports for a project.
 * @param {string} projectPath - Absolute path to the project root.
 * @returns {Array<{name: string, path: string, size: number, modified: string}>}
 */
function getReports(projectPath) {
  const reports = [];

  try {
    const reportsDir = path.join(projectPath, ".lv-zero", REPORTS_DIR_NAME);

    if (!fs.existsSync(reportsDir)) {
      return reports;
    }

    const files = fs.readdirSync(reportsDir).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      const filePath = path.join(reportsDir, file);
      try {
        const stat = fs.statSync(filePath);
        reports.push({
          name: file,
          path: filePath,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      } catch {
        // skip
      }
    }

    // Sort by modification time, newest first
    reports.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  } catch {
    // reports dir doesn't exist yet
  }

  return reports;
}

// ────────────────────────────────────────────────────────────────────────────
// Internal: Save report to disk
// ────────────────────────────────────────────────────────────────────────────

/**
 * Save a review report to .lv-zero/codex-reports/.
 * @param {object|Array<object>} report - Review result(s).
 * @param {string} projectPath - Absolute path to the project root.
 * @returns {string} Path to saved report file.
 */
function saveReport(report, projectPath) {
  const reportsDir = path.join(projectPath, ".lv-zero", REPORTS_DIR_NAME);
  fs.mkdirSync(reportsDir, { recursive: true });

  const results = Array.isArray(report) ? report : [report];
  const fileName = `review-${new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19)}.md`;
  const filePath = path.join(reportsDir, fileName);

  const md = generateReportMd(report);
  fs.writeFileSync(filePath, md, "utf-8");

  return filePath;
}

// ────────────────────────────────────────────────────────────────────────────
// Exports
// ────────────────────────────────────────────────────────────────────────────

module.exports = {
  checkSpecCompliance,
  checkCodeQuality,
  reviewFile,
  reviewAllChanged,
  generateReportMd,
  getReports,
  saveReport,
};
