/**
 * Frontend-Design Auditor
 * Analyzes UI/UX code (CSS, HTML, JSX) for design quality, accessibility,
 * and consistency. Standalone module — works with or without CSV data files.
 *
 * Severity levels: critical, error, warning, info
 * Score: 0–100 (deductions: critical=30, error=15, warning=5, info=0)
 *
 * Results: { issues: [], score: number, suggestions: [], fileName?: string }
 */

const fs = require("fs");
const path = require("path");

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 512 * 1024; // 512 KB
const SEVERITY_DEDUCTIONS = { critical: 30, error: 15, warning: 5, info: 0 };

// ─── CSV Data (Optional — graceful fallback) ────────────────────────────────

/** @type {{ colors?: string[][], typography?: string[][], styles?: string[][], icons?: string[][], spacing?: string[][], breakpoints?: string[][] } | null} */
let csvData = null;

/**
 * Try to load reference CSV data from _clones/ui-ux-pro-max-skill/.
 * Non-blocking — if not found, the auditor runs with heuristic checks only.
 */
function _tryLoadCSVData() {
  try {
    const base = path.join(__dirname, "..", "..", "_clones", "ui-ux-pro-max-skill");
    if (!fs.existsSync(base)) return null;

    const data = {};
    const files = ["colors.csv", "typography.csv", "styles.csv", "icons.csv", "spacing.csv", "breakpoints.csv"];
    for (const file of files) {
      const fp = path.join(base, file);
      if (fs.existsSync(fp)) {
        const raw = fs.readFileSync(fp, "utf-8");
        data[file.replace(".csv", "")] = raw.split("\n").filter(Boolean).map((l) => l.split(",").map((c) => c.trim()));
      }
    }
    return Object.keys(data).length > 0 ? data : null;
  } catch {
    return null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract unique CSS color values from a string.
 */
function _extractColors(text) {
  const colors = new Set();
  // Hex colors
  const hexMatches = text.match(/#[0-9a-fA-F]{3,8}\b/g);
  if (hexMatches) hexMatches.forEach((c) => colors.add(c.toLowerCase()));
  // rgb/rgba/hsl/hsla
  const funcMatches = text.match(/(?:rgb|rgba|hsl|hsla)\([^)]+\)/g);
  if (funcMatches) funcMatches.forEach((c) => colors.add(c.toLowerCase()));
  // Named CSS colors (common subset)
  const named = ["red", "blue", "green", "black", "white", "gray", "grey", "yellow", "orange", "purple", "pink", "brown", "cyan", "magenta", "lime", "teal", "navy", "maroon", "olive", "coral", "indigo", "gold", "silver", "violet", "tan", "salmon", "tomato", "plum", "orchid", "khaki", "crimson", "firebrick", "dark", "light", "transparent", "currentColor", "inherit", "initial", "unset"];
  for (const name of named) {
    const re = new RegExp(`\\b${name}\\b`, "gi");
    if (re.test(text)) colors.add(name.toLowerCase());
  }
  return [...colors];
}

/**
 * Extract unique CSS font-size values from a string.
 */
function _extractFontSizes(text) {
  const sizes = new Set();
  const matches = text.match(/(\d+\.?\d*)(px|em|rem|pt|%)/g);
  if (matches) matches.forEach((s) => sizes.add(s));
  return [...sizes];
}

/**
 * Extract unique CSS spacing values (margin, padding, gap).
 */
function _extractSpacingValues(text) {
  const values = new Set();
  const matches = text.match(/(margin|padding|gap)[\s:]+([^;{]+)/gi);
  if (matches) {
    for (const m of matches) {
      const nums = m.match(/(\d+\.?\d*)(px|em|rem)/g);
      if (nums) nums.forEach((n) => values.add(n));
    }
  }
  return [...values];
}

// ─── Audit Functions ────────────────────────────────────────────────────────

/**
 * Audit CSS code for design quality issues.
 * @param {string} code - CSS content to analyze.
 * @returns {{ issues: Array<{line: number, severity: string, message: string, type: string}>, suggestions: string[] }}
 */
function auditCSS(code) {
  const issues = [];
  const suggestions = [];

  try {
    if (!code || typeof code !== "string") {
      return { issues: [{ line: 0, severity: "error", message: "No CSS content provided", type: "empty_input" }], suggestions: ["Provide valid CSS content to audit"] };
    }

    const lines = code.split("\n");
    const textLower = code.toLowerCase();

    // 1. Check number of unique font sizes (typography consistency)
    const fontSizes = _extractFontSizes(code);
    if (fontSizes.length > 6) {
      issues.push({
        line: _findLine(lines, fontSizes[Math.floor(fontSizes.length / 2)]),
        severity: "warning",
        message: `Typography inconsistency: ${fontSizes.length} unique font sizes detected (recommended ≤ 6)`,
        type: "typography_mix",
      });
      suggestions.push("Consolidate font sizes — use a typographic scale of no more than 6 distinct sizes (e.g., 12, 14, 16, 20, 24, 32px)");
    }

    // 2. Check number of unique colors (color palette consistency)
    const colors = _extractColors(code);
    if (colors.length > 8) {
      issues.push({
        line: 0,
        severity: "warning",
        message: `Color palette overload: ${colors.length} unique colors detected (recommended ≤ 8)`,
        type: "color_harmony",
      });
      suggestions.push("Reduce the color palette — define CSS custom properties for primary, secondary, accent, and neutral colors (≤ 8 total)");
    }

    // 3. Check for hardcoded widths > 600px (responsive design)
    const pxWidths = code.match(/(width|min-width|max-width)\s*:\s*(\d{3,})px/gi);
    if (pxWidths) {
      const largeWidths = pxWidths.filter((w) => {
        const m = w.match(/:(\d+)px/);
        return m && parseInt(m[1], 10) > 600;
      });
      if (largeWidths.length > 0) {
        issues.push({
          line: _findLine(lines, largeWidths[0]),
          severity: "warning",
          message: `Hardcoded width > 600px found (${largeWidths.length} occurrence(s)) — may break responsive layout`,
          type: "responsive",
        });
        suggestions.push("Use relative units (%, vw, clamp()) instead of fixed px values > 600 for better responsiveness");
      }
    }

    // 4. Check for :hover and :focus pseudo-classes (interactive feedback)
    const hasHover = textLower.includes(":hover");
    const hasFocus = textLower.includes(":focus");
    if (!hasHover && !hasFocus) {
      issues.push({
        line: 0,
        severity: "info",
        message: "No :hover or :focus pseudo-classes found — interactive elements may lack visual feedback",
        type: "accessibility",
      });
      suggestions.push("Add :hover and :focus states for all interactive elements (buttons, links, inputs)");
    } else if (!hasFocus) {
      issues.push({
        line: 0,
        severity: "warning",
        message: "No :focus pseudo-class found — keyboard users may not see focus indicators",
        type: "accessibility",
      });
      suggestions.push("Add :focus-visible or :focus styles for keyboard navigation accessibility");
    }

    // 5. Check z-index values > 100 (layering management)
    const zIndexes = code.match(/z-index\s*:\s*(\d+)/gi);
    if (zIndexes) {
      const highZ = zIndexes.filter((z) => {
        const m = z.match(/:(\d+)/);
        return m && parseInt(m[1], 10) > 100;
      });
      if (highZ.length > 0) {
        issues.push({
          line: _findLine(lines, highZ[0]),
          severity: "info",
          message: `High z-index values (${highZ.length} > 100) — consider using a layering system`,
          type: "spacing_inconsistency",
        });
        suggestions.push("Use a z-index scale (e.g., 10=dropdown, 20=sticky, 30=modal, 40=toast) instead of arbitrary high values");
      }
    }

    // 6. Check line-height values < 1.4 (readability)
    const lineHeights = code.match(/line-height\s*:\s*(\d+\.?\d*)/gi);
    if (lineHeights) {
      const tight = lineHeights.filter((lh) => {
        const m = lh.match(/:(\d+\.?\d*)/);
        return m && parseFloat(m[1]) < 1.4;
      });
      if (tight.length > 0) {
        issues.push({
          line: _findLine(lines, tight[0]),
          severity: "warning",
          message: `Low line-height (${tight.length} < 1.4) — may reduce readability for body text`,
          type: "typography_mix",
        });
        suggestions.push("Set body text line-height to 1.5–1.7 for optimal readability");
      }
    }
  } catch (err) {
    issues.push({ line: 0, severity: "error", message: `CSS audit error: ${err.message}`, type: "audit_error" });
  }

  return { issues, suggestions };
}

/**
 * Audit HTML code for accessibility and semantic issues.
 * @param {string} code - HTML content to analyze.
 * @returns {{ issues: Array<{line: number, severity: string, message: string, type: string}>, suggestions: string[] }}
 */
function auditHTML(code) {
  const issues = [];
  const suggestions = [];

  try {
    if (!code || typeof code !== "string") {
      return { issues: [{ line: 0, severity: "error", message: "No HTML content provided", type: "empty_input" }], suggestions: ["Provide valid HTML content to audit"] };
    }

    const lines = code.split("\n");
    const textLower = code.toLowerCase();

    // 1. Check <img> elements for alt attribute
    const imgTags = code.match(/<img[^>]*>/gi);
    if (imgTags) {
      const missingAlt = imgTags.filter((img) => !/alt\s*=/i.test(img));
      if (missingAlt.length > 0) {
        issues.push({
          line: _findLine(lines, missingAlt[0]),
          severity: "error",
          message: `${missingAlt.length} <img> tag(s) missing "alt" attribute — screen readers cannot describe them`,
          type: "accessibility",
        });
        suggestions.push("Add descriptive alt attributes to all <img> tags for screen reader accessibility");
      }
    }

    // 2. Check <button> and <a> for aria-label when no visible text
    const btnTags = code.match(/<button[^>]*>/gi);
    if (btnTags) {
      const iconBtns = btnTags.filter((btn) => {
        // Button with icon class/child but no text content and no aria-label
        const hasAriaLabel = /aria-label\s*=/i.test(btn);
        const hasText = />\s*[a-zA-Z]/.test(btn);
        const hasIcon = /class\s*=\s*["'][^"']*icon/i.test(btn);
        return !hasAriaLabel && !hasText && hasIcon;
      });
      if (iconBtns.length > 0) {
        issues.push({
          line: _findLine(lines, iconBtns[0]),
          severity: "error",
          message: `${iconBtns.length} icon <button> tag(s) without aria-label — not accessible to screen readers`,
          type: "accessibility",
        });
        suggestions.push("Add aria-label to icon-only buttons (e.g., <button aria-label='Close'>✕</button>)");
      }
    }

    // Check anchor tags without aria-label or visible text
    const aTags = code.match(/<a[^>]*href\s*=\s*["'][^"']*["'][^>]*>/gi);
    if (aTags) {
      const emptyLinks = aTags.filter((a) => {
        const hasAriaLabel = /aria-label\s*=/i.test(a);
        const hasText = />\s*[a-zA-Z]/.test(a);
        return !hasAriaLabel && !hasText;
      });
      if (emptyLinks.length > 0) {
        issues.push({
          line: _findLine(lines, emptyLinks[0]),
          severity: "warning",
          message: `${emptyLinks.length} <a> tag(s) without aria-label or visible text — may confuse screen reader users`,
          type: "accessibility",
        });
        suggestions.push("Ensure all links have descriptive text or aria-label for accessibility");
      }
    }

    // 3. Check for semantic landmarks (main, nav, header, footer, aside)
    const landmarks = ["main", "nav", "header", "footer", "aside", "section", "article"];
    const missingLandmarks = landmarks.filter((tag) => !new RegExp(`<${tag}[\\s>]`, "i").test(code));
    if (missingLandmarks.length >= 3) {
      issues.push({
        line: 0,
        severity: "warning",
        message: `Missing semantic landmarks: ${missingLandmarks.join(", ")} — use ARIA landmarks for navigation`,
        type: "accessibility",
      });
      suggestions.push("Add semantic HTML5 landmark elements (<main>, <nav>, <header>, <footer>) for better document structure and screen reader navigation");
    }

    // 4. Check for inline styles
    const inlineStyles = code.match(/\bstyle\s*=\s*["'][^"']*["']/gi);
    if (inlineStyles && inlineStyles.length > 3) {
      issues.push({
        line: _findLine(lines, inlineStyles[0]),
        severity: "warning",
        message: `${inlineStyles.length} inline style(s) detected — prefer CSS classes for maintainability`,
        type: "spacing_inconsistency",
      });
      suggestions.push("Move inline styles to CSS classes for better maintainability and consistency");
    }
  } catch (err) {
    issues.push({ line: 0, severity: "error", message: `HTML audit error: ${err.message}`, type: "audit_error" });
  }

  return { issues, suggestions };
}

/**
 * Audit JSX/React code for accessibility and best practices.
 * @param {string} code - JSX/TSX content to analyze.
 * @returns {{ issues: Array<{line: number, severity: string, message: string, type: string}>, suggestions: string[] }}
 */
function auditJSX(code) {
  const issues = [];
  const suggestions = [];

  try {
    if (!code || typeof code !== "string") {
      return { issues: [{ line: 0, severity: "error", message: "No JSX content provided", type: "empty_input" }], suggestions: ["Provide valid JSX content to audit"] };
    }

    const lines = code.split("\n");
    const textLower = code.toLowerCase();

    // 1. Check <img> elements for alt attribute in JSX
    const imgTags = code.match(/<img[^>]*\/?>/gi);
    if (imgTags) {
      const missingAlt = imgTags.filter((img) => !/\balt\s*=/i.test(img));
      if (missingAlt.length > 0) {
        issues.push({
          line: _findLine(lines, missingAlt[0]),
          severity: "error",
          message: `${missingAlt.length} <img> tag(s) missing alt prop in JSX — screen readers cannot describe them`,
          type: "accessibility",
        });
        suggestions.push("Add alt prop to all <img> elements in JSX (even if empty alt='' for decorative images)");
      }
    }

    // 2. Check <button> without aria-label (icon buttons in JSX)
    const btnTags = code.match(/<button[^>]*>/gi);
    if (btnTags) {
      const iconBtns = btnTags.filter((btn) => {
        const hasAriaLabel = /\b(aria-label|aria-labelledby)\s*=/i.test(btn);
        const hasText = />\s*[a-zA-Z]/.test(btn);
        return !hasAriaLabel && !hasText;
      });
      if (iconBtns.length > 0) {
        issues.push({
          line: _findLine(lines, iconBtns[0]),
          severity: "error",
          message: `${iconBtns.length} <button> in JSX without aria-label or visible text — not accessible`,
          type: "accessibility",
        });
        suggestions.push("Add aria-label to icon-only buttons in JSX (e.g., <button aria-label='Close'>✕</button>)");
      }
    }

    // 3. Check for inline style objects ({{ }}) in JSX
    const inlineStyles = code.match(/\bstyle\s*=\s*\{\s*\{/g);
    if (inlineStyles && inlineStyles.length > 2) {
      issues.push({
        line: _findLine(lines, inlineStyles[0]),
        severity: "warning",
        message: `${inlineStyles.length} inline style object(s) detected in JSX — prefer CSS modules or styled-components`,
        type: "spacing_inconsistency",
      });
      suggestions.push("Use CSS modules, styled-components, or Tailwind classes instead of inline style objects in JSX");
    }

    // 4. Check for missing semantic landmarks
    const landmarks = ["<main", "<nav", "<header", "<footer", "<aside"];
    const missingJSX = landmarks.filter((tag) => !textLower.includes(tag));
    if (missingJSX.length >= 2) {
      issues.push({
        line: 0,
        severity: "info",
        message: `Consider using semantic HTML elements (${missingJSX.join(", ")}) for better accessibility`,
        type: "accessibility",
      });
      suggestions.push("Use semantic JSX elements (<main>, <nav>, <header>, <footer>) for better document structure");
    }

    // 5. Check for interactive elements without onClick handler
    const divClick = code.match(/<div[^>]*\bonClick\s*=/gi);
    const btnCount = btnTags ? btnTags.length : 0;
    if (!divClick && btnCount === 0 && code.includes("return (")) {
      issues.push({
        line: 0,
        severity: "info",
        message: "No interactive elements (buttons, clickable divs) detected in JSX — verify UI is functional",
        type: "accessibility",
      });
    }
  } catch (err) {
    issues.push({ line: 0, severity: "error", message: `JSX audit error: ${err.message}`, type: "audit_error" });
  }

  return { issues, suggestions };
}

/**
 * Find the line number (1-based) of a substring in an array of lines.
 * @param {string[]} lines
 * @param {string} searchStr
 * @returns {number}
 */
function _findLine(lines, searchStr) {
  if (!searchStr) return 0;
  const searchLower = searchStr.toLowerCase().substring(0, 80);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(searchLower)) return i + 1;
  }
  return 0;
}

/**
 * Calculate score from issues array.
 * @param {Array<{severity: string}>} issues
 * @returns {number}
 */
function _calculateScore(issues) {
  let deduction = 0;
  for (const issue of issues) {
    deduction += SEVERITY_DEDUCTIONS[issue.severity] || 0;
  }
  return Math.max(0, Math.min(100, 100 - deduction));
}

/**
 * Detect file type by extension.
 * @param {string} filePath
 * @returns {'css'|'html'|'jsx'|'unknown'}
 */
function _detectFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".css") return "css";
  if (ext === ".html" || ext === ".htm") return "html";
  if ([".jsx", ".tsx", ".js", ".ts"].includes(ext)) {
    // For .js/.ts, check if they look like JSX (contain React/JSX patterns)
    return "jsx";
  }
  return "unknown";
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Audit a single file's frontend code.
 * @param {string} filePath - Absolute path to the file.
 * @param {string} projectPath - Absolute path to the project root.
 * @returns {{ issues: Array, score: number, suggestions: string[], fileName: string, fileType: string }}
 */
function auditFile(filePath, projectPath) {
  const result = {
    issues: [],
    score: 100,
    suggestions: [],
    fileName: path.basename(filePath),
    fileType: "unknown",
  };

  try {
    if (!filePath || !fs.existsSync(filePath)) {
      result.issues.push({ line: 0, severity: "error", message: `File not found: ${filePath}`, type: "file_not_found" });
      result.score = _calculateScore(result.issues);
      return result;
    }

    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      result.issues.push({ line: 0, severity: "warning", message: `File too large (${(stat.size / 1024).toFixed(0)} KB) — skipping audit`, type: "file_too_large" });
      result.score = _calculateScore(result.issues);
      return result;
    }

    const ext = path.extname(filePath).toLowerCase();
    let fileType = "unknown";

    if (ext === ".css") {
      fileType = "css";
    } else if (ext === ".html" || ext === ".htm") {
      fileType = "html";
    } else if ([".jsx", ".tsx"].includes(ext)) {
      fileType = "jsx";
    } else if (ext === ".js" || ext === ".ts") {
      fileType = "jsx"; // Treat as potential JSX
    } else {
      result.issues.push({ line: 0, severity: "info", message: `Unsupported file type: ${ext}`, type: "unsupported_type" });
      result.score = _calculateScore(result.issues);
      result.fileType = fileType;
      return result;
    }

    result.fileType = fileType;
    const code = fs.readFileSync(filePath, "utf-8");

    // Run appropriate audit
    let auditResult;
    if (fileType === "css") {
      auditResult = auditCSS(code);
    } else if (fileType === "html") {
      auditResult = auditHTML(code);
    } else {
      // JSX: run both JSX and HTML audits
      const jsxResult = auditJSX(code);
      const htmlResult = auditHTML(code);
      // Merge issues (deduplicate by type + message)
      const seen = new Set();
      auditResult = { issues: [], suggestions: [] };
      for (const item of [...jsxResult.issues, ...htmlResult.issues]) {
        const key = `${item.type}:${item.message.substring(0, 40)}`;
        if (!seen.has(key)) {
          seen.add(key);
          auditResult.issues.push(item);
        }
      }
      auditResult.suggestions = [...new Set([...jsxResult.suggestions, ...htmlResult.suggestions])];
    }

    result.issues = auditResult.issues;
    result.suggestions = auditResult.suggestions;
    result.score = _calculateScore(result.issues);
  } catch (err) {
    result.issues.push({ line: 0, severity: "error", message: `Audit error: ${err.message}`, type: "audit_error" });
    result.score = _calculateScore(result.issues);
  }

  return result;
}

/**
 * Audit all frontend files in a project directory.
 * Scans for .css, .html, .jsx, .tsx files (up to 100 files).
 * @param {string} projectPath - Absolute path to the project root.
 * @returns {{ files: Array, summary: { totalFiles: number, avgScore: number, totalIssues: number, criticalCount: number, errorCount: number, warningCount: number, infoCount: number }, suggestions: string[] }}
 */
function auditDirectory(projectPath) {
  const results = [];
  const allSuggestions = new Set();
  let totalIssues = 0;
  let criticalCount = 0;
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  const scanDirs = [
    projectPath,
    path.join(projectPath, "src"),
    path.join(projectPath, "ui"),
    path.join(projectPath, "app"),
    path.join(projectPath, "client"),
    path.join(projectPath, "frontend"),
    path.join(projectPath, "components"),
    path.join(projectPath, "pages"),
    path.join(projectPath, "styles"),
    path.join(projectPath, "css"),
  ];

  const scanned = new Set();
  const frontendExts = [".css", ".html", ".htm", ".jsx", ".tsx", ".js", ".ts"];

  try {
    for (const dir of scanDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (results.length >= 100) break; // cap at 100 files
          const ext = path.extname(entry.name).toLowerCase();
          if (!frontendExts.includes(ext)) continue;
          const fullPath = path.join(dir, entry.name);
          if (scanned.has(fullPath)) continue;
          scanned.add(fullPath);

          const result = auditFile(fullPath, projectPath);
          results.push(result);
          totalIssues += result.issues.length;
          for (const issue of result.issues) {
            if (issue.severity === "critical") criticalCount++;
            else if (issue.severity === "error") errorCount++;
            else if (issue.severity === "warning") warningCount++;
            else if (issue.severity === "info") infoCount++;
          }
          result.suggestions.forEach((s) => allSuggestions.add(s));
        }
      } catch {
        // skip directories we can't read
      }
    }

    // If no files found in common dirs, try recursive scan of projectPath
    if (results.length === 0) {
      try {
        _walkDir(projectPath, results, scanned, allSuggestions, 100, frontendExts);
      } catch {
        // fallback silently
      }
    }

    const totalFiles = results.length;
    const avgScore = totalFiles > 0 ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / totalFiles) : 0;

    return {
      files: results,
      summary: {
        totalFiles,
        avgScore,
        totalIssues,
        criticalCount,
        errorCount,
        warningCount,
        infoCount,
      },
      suggestions: [...allSuggestions],
    };
  } catch (err) {
    return {
      files: [],
      summary: { totalFiles: 0, avgScore: 0, totalIssues: 0, criticalCount: 0, errorCount: 0, warningCount: 0, infoCount: 0 },
      suggestions: [`Audit error: ${err.message}`],
    };
  }
}

/**
 * Recursively walk a directory collecting frontend files.
 */
function _walkDir(dirPath, results, scanned, allSuggestions, maxFiles, exts, depth = 0) {
  if (depth > 5 || results.length >= maxFiles) return;
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (results.length >= maxFiles) break;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
        _walkDir(fullPath, results, scanned, allSuggestions, maxFiles, exts, depth + 1);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!exts.includes(ext)) continue;
      if (scanned.has(fullPath)) continue;
      scanned.add(fullPath);
      const result = auditFile(fullPath, dirPath);
      results.push(result);
      result.suggestions.forEach((s) => allSuggestions.add(s));
    }
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  auditCSS,
  auditHTML,
  auditJSX,
  auditFile,
  auditDirectory,
};
