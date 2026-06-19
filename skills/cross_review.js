/**
 * cross_review — Cross-Model Code Review Skill
 *
 * Phase 6: Cross-Model Second Opinion (gstack /codex port)
 *
 * Runs the same code review through 2+ models (DeepSeek Flash + DeepSeek Pro)
 * and compares findings. Highlights:
 *   - Findings that overlap between models (high confidence)
 *   - Unique findings per model (model-specific insights)
 *   - Consolidated report with merged recommendations
 *
 * Uses the existing lv-zero provider system — no external API needed.
 *   - DeepSeek V4 Flash (fast/cheap) — first pass, broad coverage
 *   - DeepSeek V4 Pro (reasoner) — deep analysis on flagged areas
 *
 * gstack inspiration:
 *   /codex gets an independent review from OpenAI Codex CLI.
 *   Cross-model analysis shows which findings overlap and which are unique.
 *
 * @module skills/cross_review
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

/** Model configurations */
const MODELS = {
  flash: {
    name: "DeepSeek V4 Flash",
    model: process.env.DEEPSEEK_MODEL_CHEAP || "deepseek-v4-flash",
    tier: "cheap",
    description: "Fast, broad-coverage first pass",
  },
  pro: {
    name: "DeepSeek V4 Pro",
    model: process.env.DEEPSEEK_MODEL_REASONER || "deepseek-v4-pro",
    tier: "reasoner",
    description: "Deep reasoning, detailed analysis",
  },
};

/** Review prompt for the models */
const REVIEW_SYSTEM_PROMPT = `You are a Staff Engineer doing a code review. Your job is to find bugs, security issues, and maintainability problems.

Focus on:
1. **Logic errors** — Off-by-one, incorrect comparisons, missing null checks, race conditions
2. **Security issues** — Injection, XSS, hardcoded secrets, missing auth, path traversal
3. **Performance problems** — N+1 queries, memory leaks, sync instead of async
4. **Maintainability** — Magic numbers, deep nesting, dead code, single responsibility violations

For each finding, provide:
- File and line number
- Severity (HIGH/MEDIUM/LOW)
- Description of the issue
- Suggested fix

Format your response as JSON:
{
  "findings": [
    {
      "file": "path/to/file.js",
      "line": 42,
      "severity": "HIGH",
      "type": "logic|security|performance|maintainability",
      "title": "Short description",
      "description": "Detailed explanation",
      "suggestion": "How to fix it"
    }
  ],
  "summary": {
    "total": 0,
    "high": 0,
    "medium": 0,
    "low": 0
  },
  "overallVerdict": "APPROVED|CHANGES_REQUESTED|NEEDS_DISCUSSION"
}

Respond with ONLY the JSON. No markdown, no explanations.`;

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Factory
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Creates an OpenAI-compatible client for a given model config.
 * Uses the same API key and base URL as the orchestrator.
 *
 * @param {object} modelConfig - Model configuration from MODELS
 * @returns {OpenAI}
 */
function createClient(modelConfig) {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY;
  const baseURL = process.env.DEEPSEEK_BASE_URL || process.env.LLM_BASE_URL || "https://api.deepseek.com/v1";

  if (!apiKey) {
    throw new Error("No API key found. Set DEEPSEEK_API_KEY or LLM_API_KEY in .env");
  }

  return new OpenAI({
    apiKey,
    baseURL,
    timeout: 120000,
    maxRetries: 1,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Review Engine
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Runs a single model review.
 *
 * @param {object} client - OpenAI client
 * @param {string} model - Model name
 * @param {string} codeContext - Code to review
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - Abort signal
 * @returns {Promise<object>}
 */
async function runModelReview(client, model, codeContext, options = {}) {
  const messages = [
    { role: "system", content: REVIEW_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Please review the following code:\n\n\`\`\`\n${codeContext.substring(0, 8000)}\n\`\`\``,
    },
  ];

  try {
    const completion = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.1,
      max_tokens: 4000,
      response_format: { type: "json_object" },
    }, {
      signal: options.signal,
    });

    const content = completion.choices?.[0]?.message?.content || "{}";

    // Parse JSON response
    let result;
    try {
      result = JSON.parse(content);
    } catch {
      // If JSON parsing fails, extract JSON from markdown code block
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error("Failed to parse model response as JSON");
      }
    }

    return {
      success: true,
      model: MODELS[model]?.name || model,
      modelKey: model,
      ...result,
      rawResponse: content.substring(0, 500),
    };
  } catch (err) {
    return {
      success: false,
      model: MODELS[model]?.name || model,
      modelKey: model,
      error: err.message,
      findings: [],
      summary: { total: 0, high: 0, medium: 0, low: 0 },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Result Merger
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Merges findings from multiple models.
 * Identifies overlapping and unique findings.
 *
 * @param {Array} modelResults - Results from each model
 * @returns {object} Merged report
 */
function mergeResults(modelResults) {
  const allFindings = [];
  const findingMap = new Map(); // key → { models: [], finding }

  for (const result of modelResults) {
    if (!result.success || !result.findings) continue;

    for (const finding of result.findings) {
      // Create a fingerprint for dedup: file + title (normalized)
      const key = `${finding.file || "unknown"}:${(finding.title || finding.description || "").substring(0, 60).toLowerCase()}`;

      if (findingMap.has(key)) {
        findingMap.get(key).models.push(result.modelKey);
      } else {
        findingMap.set(key, {
          models: [result.modelKey],
          finding: { ...finding },
        });
      }
    }
  }

  // Convert map to sorted array
  for (const [key, entry] of findingMap) {
    allFindings.push({
      ...entry.finding,
      foundBy: entry.models,
      foundByCount: entry.models.length,
      consensus: entry.models.length >= 2,
    });
  }

  // Sort: consensus first, then by severity
  const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  allFindings.sort((a, b) => {
    if (a.consensus !== b.consensus) return a.consensus ? -1 : 1;
    return (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99);
  });

  // Calculate merged summary
  const mergedSummary = {
    total: allFindings.length,
    high: allFindings.filter((f) => f.severity === "HIGH").length,
    medium: allFindings.filter((f) => f.severity === "MEDIUM").length,
    low: allFindings.filter((f) => f.severity === "LOW").length,
    consensus: allFindings.filter((f) => f.consensus).length,
    unique: allFindings.filter((f) => !f.consensus).length,
  };

  return {
    findings: allFindings,
    summary: mergedSummary,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Report Generator
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generates a markdown report from merged results.
 *
 * @param {Array} modelResults - Raw results from each model
 * @param {object} merged - Merged findings
 * @param {object} options
 * @param {string} options.target - What was reviewed
 * @returns {string}
 */
function generateReport(modelResults, merged, options = {}) {
  const { target } = options;
  const now = new Date().toISOString().split("T")[0];

  let report = `# 🔄 Cross-Model Code Review\n\n`;
  report += `**Target:** ${target || "Unknown"}\n`;
  report += `**Date:** ${now}\n\n`;

  // Models used
  report += `## Models Used\n\n`;
  for (const result of modelResults) {
    const status = result.success ? "✅" : "❌";
    report += `- ${status} **${result.model}** — ${MODELS[result.modelKey]?.description || ""}\n`;
    if (result.success) {
      report += `  - Findings: ${result.summary?.total || 0} (${result.summary?.high || 0} HIGH, ${result.summary?.medium || 0} MEDIUM, ${result.summary?.low || 0} LOW)\n`;
    } else {
      report += `  - Error: ${result.error}\n`;
    }
  }
  report += "\n";

  // Executive Summary
  report += `## Executive Summary\n\n`;
  report += `| Metric | Value |\n|--------|-------|\n`;
  report += `| **Total Findings** | ${merged.summary.total} |\n`;
  report += `| 🔴 HIGH | ${merged.summary.high} |\n`;
  report += `| 🟡 MEDIUM | ${merged.summary.medium} |\n`;
  report += `| 🟢 LOW | ${merged.summary.low} |\n`;
  report += `| ✅ Consensus (both models) | ${merged.summary.consensus} |\n`;
  report += `| 🔍 Unique (one model only) | ${merged.summary.unique} |\n\n`;

  // Consensus findings (high confidence)
  const consensusFindings = merged.findings.filter((f) => f.consensus && f.severity === "HIGH");
  if (consensusFindings.length > 0) {
    report += `## 🔴 High-Confidence Findings (Both Models Agree)\n\n`;
    for (const f of consensusFindings) {
      report += `### ${f.title || "Finding"}\n\n`;
      report += `- **File:** \`${f.file}:${f.line}\`\n`;
      report += `- **Severity:** ${f.severity}\n`;
      report += `- **Type:** ${f.type || "unknown"}\n`;
      report += `- **Found by:** ${f.foundBy.join(", ")}\n\n`;
      report += `${f.description}\n\n`;
      if (f.suggestion) {
        report += `**Suggestion:** ${f.suggestion}\n\n`;
      }
      report += `---\n\n`;
    }
  }

  // All findings table
  report += `## All Findings\n\n`;
  report += `| # | Severity | Type | File | Line | Title | Consensus |\n`;
  report += `|---|----------|------|------|------|-------|-----------|\n`;
  merged.findings.forEach((f, i) => {
    const sevIcon = f.severity === "HIGH" ? "🔴" : f.severity === "MEDIUM" ? "🟡" : "🟢";
    const consensusIcon = f.consensus ? "✅" : "🔍";
    report += `| ${i + 1} | ${sevIcon} ${f.severity} | ${f.type || "?"} | \`${f.file || "?"}\` | ${f.line || "?"} | ${(f.title || "").substring(0, 60)} | ${consensusIcon} |\n`;
  });
  report += "\n";

  // Model-specific unique findings
  for (const result of modelResults) {
    if (!result.success) continue;
    const modelKey = result.modelKey;
    const uniqueFindings = merged.findings.filter(
      (f) => !f.consensus && f.foundBy.includes(modelKey)
    );
    if (uniqueFindings.length > 0) {
      report += `## 🔍 Unique to ${result.model}\n\n`;
      report += `| # | Severity | File | Line | Title |\n`;
      report += `|---|----------|------|------|-------|\n`;
      uniqueFindings.forEach((f, i) => {
        const sevIcon = f.severity === "HIGH" ? "🔴" : f.severity === "MEDIUM" ? "🟡" : "🟢";
        report += `| ${i + 1} | ${sevIcon} ${f.severity} | \`${f.file || "?"}\` | ${f.line || "?"} | ${(f.title || "").substring(0, 60)} |\n`;
      });
      report += "\n";
    }
  }

  // Verdicts
  report += `## Model Verdicts\n\n`;
  for (const result of modelResults) {
    if (result.success) {
      report += `- **${result.model}:** ${result.overallVerdict || "No verdict"}\n`;
    }
  }
  report += "\n";

  report += `---\n*Report generated by lv-zero Cross-Model Review on ${now}*\n`;

  return report;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Skill Definition
// ═══════════════════════════════════════════════════════════════════════════════

export default {
  name: "cross_review",
  description:
    "Cross-model code review. Runs the same code review through 2 models " +
    "(DeepSeek V4 Flash + DeepSeek V4 Pro) and compares findings. " +
    "Highlights consensus findings (both models agree — high confidence) " +
    "and unique findings per model. " +
    "Actions: review (review specific files), review_all (review all changed files), " +
    "report (show last review report).",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["review", "review_all", "report"],
        description:
          "Action to perform:\n" +
          "- 'review' → Review specific file(s) (requires: files)\n" +
          "- 'review_all' → Review all changed files (git diff)\n" +
          "- 'report' → Show the last cross-model review report",
      },
      files: {
        type: "array",
        items: { type: "string" },
        description:
          "File path(s) to review. Required for 'review' action. " +
          "Example: ['src/file1.js', 'src/file2.js']",
      },
      context: {
        type: "string",
        description:
          "Additional context about the code being reviewed. " +
          "Example: 'This is a new authentication module'",
      },
    },
    required: ["action"],
  },

  handler: async (params, options = {}) => {
    const { action, files, context } = params;

    // Store last report globally
    if (!global.__cross_review_last) {
      global.__cross_review_last = null;
    }

    switch (action) {
      case "review": {
        if (!files || files.length === 0) {
          return { success: false, error: "files array is required for review action" };
        }

        // Read files
        const codeSections = [];
        for (const file of files) {
          const filePath = path.resolve(file);
          if (!fs.existsSync(filePath)) {
            return { success: false, error: `File not found: ${file}` };
          }
          const content = fs.readFileSync(filePath, "utf-8");
          codeSections.push(`### File: ${file}\n\`\`\`\n${content}\n\`\`\``);
        }

        const codeContext = codeSections.join("\n\n") + (context ? `\n\nContext: ${context}` : "");

        // Create clients
        let flashClient, proClient;
        try {
          flashClient = createClient(MODELS.flash);
          proClient = createClient(MODELS.pro);
        } catch (err) {
          return { success: false, error: `Failed to create API client: ${err.message}` };
        }

        // Run both models in parallel
        const abortController = new AbortController();
        const signal = abortController.signal;

        const [flashResult, proResult] = await Promise.all([
          runModelReview(flashClient, "flash", codeContext, { signal }),
          runModelReview(proClient, "pro", codeContext, { signal }),
        ]);

        const modelResults = [flashResult, proResult];

        // Merge results
        const merged = mergeResults(modelResults);

        // Generate report
        const target = files.join(", ");
        const report = generateReport(modelResults, merged, { target });

        // Store for later retrieval
        global.__cross_review_last = {
          target,
          summary: merged.summary,
          report,
          modelResults: modelResults.map((r) => ({
            model: r.model,
            success: r.success,
            summary: r.summary,
            verdict: r.overallVerdict,
          })),
          timestamp: new Date().toISOString(),
        };

        return {
          success: true,
          summary: merged.summary,
          report,
          models: modelResults.map((r) => ({
            name: r.model,
            success: r.success,
            findings: r.summary?.total || 0,
            verdict: r.overallVerdict || "N/A",
          })),
          message: `Cross-model review complete: ${merged.summary.total} findings (${merged.summary.consensus} consensus, ${merged.summary.unique} unique)`,
        };
      }

      case "review_all": {
        // Review all files changed in git diff
        const { execSync } = await import("child_process");
        let diffOutput;
        try {
          diffOutput = execSync("git diff --name-only HEAD~1", {
            encoding: "utf-8",
            timeout: 10000,
            cwd: process.cwd(),
          });
        } catch {
          // Try diff against main
          try {
            diffOutput = execSync("git diff --name-only main...HEAD", {
              encoding: "utf-8",
              timeout: 10000,
              cwd: process.cwd(),
            });
          } catch {
            return { success: false, error: "Not a git repository or no changes to review" };
          }
        }

        const changedFiles = diffOutput.split("\n").filter(Boolean).map((f) => f.trim());
        if (changedFiles.length === 0) {
          return { success: false, error: "No changed files found" };
        }

        // Filter to source files only
        const sourceFiles = changedFiles.filter((f) =>
          /\.(js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java)$/i.test(f)
        );

        if (sourceFiles.length === 0) {
          return { success: false, error: "No source files changed. Changed files: " + changedFiles.join(", ") };
        }

        // Re-run with the discovered files
        return await this.handler({
          action: "review",
          files: sourceFiles,
          context: params.context || `Auto-detected from git diff. ${sourceFiles.length} source files changed.`,
        }, options);
      }

      case "report": {
        if (!global.__cross_review_last) {
          return {
            success: true,
            message: "No cross-model review has been run yet. Use action: 'review' to run one.",
            report: null,
          };
        }
        return {
          success: true,
          ...global.__cross_review_last,
        };
      }

      default:
        return { success: false, error: `Unknown action: "${action}"` };
    }
  },
};
