/**
 * documentation — Document Generation Pipeline Skill
 *
 * Phase 7: Document Generation (gstack /document-release port)
 *
 * Detects stale documentation, generates missing docs from code analysis,
 * and auto-updates README and key docs on significant changes.
 * Uses Diataxis framework (reference/how-to/tutorial/explanation).
 *
 * @module skills/documentation
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  name: "documentation",
  description:
    "Documentation generation and maintenance. Detects stale documentation, " +
    "generates missing docs from code analysis, updates README and key files. " +
    "Uses Diataxis framework (reference, how-to, tutorial, explanation). " +
    "Actions: scan (find stale/missing docs), generate (create docs for files), " +
    "update-readme (update README.md), report (show last doc report).",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["scan", "generate", "update-readme", "report"],
        description:
          "Action to perform:\n" +
          "- 'scan' → Scan project for files missing documentation\n" +
          "- 'generate' → Generate documentation for specified files (requires: files)\n" +
          "- 'update-readme' → Update README.md with project overview\n" +
          "- 'report' → Show last documentation report",
      },
      files: {
        type: "array",
        items: { type: "string" },
        description: "File path(s) to generate documentation for.",
      },
      type: {
        type: "string",
        enum: ["reference", "how-to", "tutorial", "explanation"],
        description: "Diataxis documentation type to generate.",
      },
    },
    required: ["action"],
  },

  handler: async (params, options = {}) => {
    const { action, files, type } = params;

    if (!global.__doc_last_report) global.__doc_last_report = null;

    switch (action) {
      case "scan": {
        const rootDir = process.cwd();
        const findings = [];

        // Find source files without corresponding docs
        const sourceDirs = ["src", "skills"];
        for (const dir of sourceDirs) {
          const fullPath = path.resolve(rootDir, dir);
          if (!fs.existsSync(fullPath)) continue;

          const entries = fs.readdirSync(fullPath, { recursive: true })
            .filter((f) => f.endsWith(".js") || f.endsWith(".mjs") || f.endsWith(".cjs"))
            .filter((f) => !f.includes("node_modules"));

          for (const entry of entries) {
            const docPath = entry.replace(/\.(js|mjs|cjs)$/, ".md");
            const fullDocPath = path.resolve(rootDir, "docs", docPath);
            if (!fs.existsSync(fullDocPath)) {
              findings.push({
                file: entry,
                missingDoc: `docs/${docPath}`,
                priority: entry.includes("index.") || entry.includes("main.") ? "HIGH" : "MEDIUM",
              });
            }
          }
        }

        // Check README freshness
        const readmePath = path.resolve(rootDir, "README.md");
        let readmeStale = false;
        if (fs.existsSync(readmePath)) {
          const readmeStat = fs.statSync(readmePath);
          const packageStat = fs.statSync(path.resolve(rootDir, "package.json"));
          readmeStale = readmeStat.mtimeMs < packageStat.mtimeMs;
        }

        const report = {
          totalMissing: findings.length,
          high: findings.filter((f) => f.priority === "HIGH").length,
          medium: findings.filter((f) => f.priority === "MEDIUM").length,
          readmeStale,
          findings,
          timestamp: new Date().toISOString(),
        };

        global.__doc_last_report = report;

        return {
          success: true,
          ...report,
          message: `Doc scan: ${findings.length} files missing docs (${report.high} HIGH priority), README ${readmeStale ? "needs update" : "is current"}`,
        };
      }

      case "generate": {
        if (!files || files.length === 0) {
          return { success: false, error: "files array is required" };
        }

        const docType = type || "reference";
        const generated = [];

        for (const file of files) {
          const filePath = path.resolve(file);
          if (!fs.existsSync(filePath)) {
            generated.push({ file, success: false, error: "File not found" });
            continue;
          }

          const content = fs.readFileSync(filePath, "utf-8");
          const docPath = file.replace(/\.(js|mjs|cjs)$/, ".md");
          const fullDocPath = path.resolve("docs", docPath);

          // Generate documentation based on type
          let doc = `# ${path.basename(file)}\n\n`;
          doc += `> **Type:** ${docType} documentation\n`;
          doc += `> **Source:** \`${file}\`\n\n`;

          // Extract JSDoc comments
          const jsdocMatches = content.match(/\/\*\*[\s\S]*?\*\//g) || [];
          if (jsdocMatches.length > 0) {
            doc += `## API Reference\n\n`;
            for (const jsdoc of jsdocMatches) {
              const cleaned = jsdoc.replace(/^\/\*\*|^\s*\* ?|\*\/$/gm, "").trim();
              doc += `${cleaned}\n\n`;
            }
          }

          // Extract function signatures
          const funcMatches = content.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)/g) || [];
          if (funcMatches.length > 0) {
            doc += `## Functions\n\n`;
            for (const func of funcMatches) {
              doc += `- \`${func.trim()}\`\n`;
            }
            doc += "\n";
          }

          // Extract exports
          const exportMatches = content.match(/export\s+(?:default\s+)?(?:const|let|var|class|function)\s+(\w+)/g) || [];
          if (exportMatches.length > 0) {
            doc += `## Exports\n\n`;
            for (const exp of exportMatches) {
              doc += `- \`${exp.trim()}\`\n`;
            }
            doc += "\n";
          }

          // Ensure docs directory exists
          const docDir = path.dirname(fullDocPath);
          if (!fs.existsSync(docDir)) {
            fs.mkdirSync(docDir, { recursive: true });
          }

          fs.writeFileSync(fullDocPath, doc, "utf-8");
          generated.push({ file, docPath: `docs/${docPath}`, success: true });
        }

        return {
          success: true,
          generated,
          count: generated.filter((g) => g.success).length,
          message: `Generated ${generated.filter((g) => g.success).length}/${generated.length} documentation files`,
        };
      }

      case "update-readme": {
        const readmePath = path.resolve(process.cwd(), "README.md");
        const packagePath = path.resolve(process.cwd(), "package.json");

        if (!fs.existsSync(packagePath)) {
          return { success: false, error: "No package.json found" };
        }

        const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"));

        let readme = `# ${pkg.name || "Project"}\n\n`;
        readme += `${pkg.description || ""}\n\n`;
        readme += `## Installation\n\n\`\`\`bash\nnpm install\n\`\`\`\n\n`;
        readme += `## Usage\n\n\`\`\`bash\nnpm start\n\`\`\`\n\n`;

        if (pkg.scripts) {
          readme += `## Scripts\n\n`;
          readme += `| Script | Description |\n|--------|-------------|\n`;
          for (const [name, script] of Object.entries(pkg.scripts)) {
            readme += `| \`${name}\` | \`${script}\` |\n`;
          }
          readme += "\n";
        }

        if (pkg.dependencies) {
          readme += `## Dependencies\n\n`;
          for (const [dep, ver] of Object.entries(pkg.dependencies)) {
            readme += `- \`${dep}@${ver}\`\n`;
          }
          readme += "\n";
        }

        readme += `## License\n\n${pkg.license || "MIT"}\n`;

        fs.writeFileSync(readmePath, readme, "utf-8");

        return {
          success: true,
          message: "README.md updated successfully",
          length: readme.length,
        };
      }

      case "report": {
        return {
          success: true,
          lastReport: global.__doc_last_report,
        };
      }

      default:
        return { success: false, error: `Unknown action: "${action}"` };
    }
  },
};
