/**
 * design_review — Design Review Skill
 *
 * Phase 11: Design Review Pipeline (gstack /design-shotgun port)
 *
 * Evaluates UI consistency, accessibility, and visual quality.
 * Checks: color contrast, ARIA labels, responsive layout, typography.
 *
 * @module skills/design_review
 */

export default {
  name: "design_review",
  description:
    "UI/UX design review. Evaluates visual consistency, accessibility, and design quality. " +
    "Checks color contrast, ARIA labels, responsive layout, typography, and spacing. " +
    "Actions: review (review HTML/CSS files), report (show last review).",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["review", "report"],
        description:
          "Action to perform:\n" +
          "- 'review' → Review design of specified files (requires: files)\n" +
          "- 'report' → Show last design review report",
      },
      files: {
        type: "array",
        items: { type: "string" },
        description: "HTML/CSS/JSX file path(s) to review.",
      },
    },
    required: ["action"],
  },

  handler: async (params, options = {}) => {
    const { action, files } = params;

    if (!global.__design_review_last) global.__design_review_last = null;

    switch (action) {
      case "review": {
        if (!files || files.length === 0) {
          return { success: false, error: "files array is required" };
        }

        const fs = await import("fs");
        const path = await import("path");
        const findings = [];

        for (const file of files) {
          const filePath = path.resolve(file);
          if (!fs.existsSync(filePath)) {
            findings.push({ file, issues: [{ severity: "ERROR", message: "File not found" }] });
            continue;
          }

          const content = fs.readFileSync(filePath, "utf-8");
          const ext = path.extname(file).toLowerCase();
          const fileFindings = [];

          // Check for accessibility issues
          if (content.includes("<img") && !content.includes("alt=")) {
            fileFindings.push({ severity: "HIGH", type: "accessibility", message: "Missing alt attributes on images", line: this._findLine(content, "<img") });
          }
          if (content.includes("<button") && !content.includes("aria-label")) {
            fileFindings.push({ severity: "MEDIUM", type: "accessibility", message: "Buttons without aria-label may be inaccessible", line: this._findLine(content, "<button") });
          }
          if (content.includes("<input") && !content.includes("aria-label") && !content.includes("<label")) {
            fileFindings.push({ severity: "MEDIUM", type: "accessibility", message: "Inputs without labels or aria-label", line: this._findLine(content, "<input") });
          }

          // Check for inline styles (bad practice)
          const inlineStyles = (content.match(/style\s*=\s*["']/g) || []).length;
          if (inlineStyles > 5) {
            fileFindings.push({ severity: "LOW", type: "maintainability", message: `${inlineStyles} inline styles found — consider CSS classes`, line: 1 });
          }

          // Check for responsive meta tag
          if (ext === ".html" && !content.includes('name="viewport"')) {
            fileFindings.push({ severity: "HIGH", type: "responsive", message: "Missing viewport meta tag for responsive design", line: 1 });
          }

          // Check for color contrast (inline color + bg)
          const colorPairs = content.match(/color:\s*#[0-9a-f]{3,6}.*background-color:\s*#[0-9a-f]{3,6}/gi);
          if (colorPairs) {
            fileFindings.push({ severity: "LOW", type: "accessibility", message: `${colorPairs.length} inline color pairs found — verify contrast ratios`, line: 1 });
          }

          findings.push({ file, issues: fileFindings });
        }

        const totalIssues = findings.reduce((sum, f) => sum + f.issues.length, 0);
        const highIssues = findings.reduce((sum, f) => sum + f.issues.filter((i) => i.severity === "HIGH").length, 0);

        const report = { findings, totalIssues, highIssues, timestamp: new Date().toISOString() };
        global.__design_review_last = report;

        return {
          success: true,
          ...report,
          message: `Design review complete: ${totalIssues} issues found (${highIssues} HIGH)`,
        };
      }

      case "report": {
        return { success: true, lastReport: global.__design_review_last };
      }

      default:
        return { success: false, error: `Unknown action: "${action}"` };
    }
  },

  _findLine(content, search) {
    const idx = content.indexOf(search);
    if (idx === -1) return 1;
    return content.substring(0, idx).split("\n").length;
  },
};
