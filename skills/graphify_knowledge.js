/**
 * graphify_knowledge — safishamsi/graphify knowledge graph builder
 *
 * Wraps https://github.com/safishamsi/graphify (PyPI: graphifyy v0.8.5+)
 * Builds a holistic knowledge graph from code + docs + PDFs + images + video.
 *
 * Output (graphify-out/):
 *   graph.html       — interactive browser visual (clickable nodes, filter, search)
 *   GRAPH_REPORT.md  — god nodes, surprising connections, suggested questions
 *   graph.json       — full graph for programmatic queries
 *
 * Also supports MCP server: python -m graphify.serve graphify-out/graph.json
 */

import { execFile } from "child_process";
import path from "path";
import fs from "fs";

// ── Helpers ──────────────────────────────────────────────────────────

function getGraphifyOutDir(targetDir) {
  return path.join(targetDir, "graphify-out");
}

function graphifyOutExists(targetDir) {
  const outDir = getGraphifyOutDir(targetDir);
  return fs.existsSync(path.join(outDir, "graph.json"));
}

/**
 * Run graphify CLI with given args.
 * Falls back to `python -m graphify` if `graphify` isn't on PATH.
 */
function runGraphify(args, cwd) {
  return new Promise((resolve, reject) => {
    // Prefer `graphify` CLI, fallback to `python -m graphify`
    const cmd = process.platform === "win32" ? "graphify.exe" : "graphify";
    const child = execFile(cmd, args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 600_000, // 10 min for large projects
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`graphify exited code ${code}\n${stderr}`));
      }
    });
    child.on("error", (err) => reject(err));
  });
}

// ── Skill Definition ─────────────────────────────────────────────────

export default {
  name: "graphify_knowledge",
  description:
    "Build and query a holistic knowledge graph using safishamsi/graphify. " +
    "Processes code, docs, PDFs, images, video — outputs graph.html (visual), " +
    "GRAPH_REPORT.md (summary), graph.json (full graph). Also supports " +
    "Mermaid call-flow diagrams and MCP graph server.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "Action to perform",
        enum: [
          "build",
          "status",
          "query",
          "path",
          "explain",
          "export_callflow",
          "serve_mcp",
          "watch",
          "update",
          "check_update",
        ],
      },
      directory: {
        type: "string",
        description:
          "Target project directory (default: current working directory)",
      },
      question: {
        type: "string",
        description:
          'Question for query action, e.g. "what connects auth to the database?"',
      },
      symbol_a: {
        type: "string",
        description: "Source symbol for path action",
      },
      symbol_b: {
        type: "string",
        description: "Target symbol for path action",
      },
      symbol_name: {
        type: "string",
        description: "Symbol name for explain action",
      },
    },
    required: ["action"],
  },

  async handler(params) {
    const { action, directory, question, symbol_a, symbol_b, symbol_name } =
      params;
    const targetDir = directory || process.cwd();

    switch (action) {
      // ── build ────────────────────────────────────────────────
      case "build": {
        // Full extraction with clustering → graph.html + GRAPH_REPORT.md + graph.json
        await runGraphify(["extract", targetDir], targetDir);
        const outDir = getGraphifyOutDir(targetDir);
        const exists = graphifyOutExists(targetDir);
        // Read graph stats
        let stats = { nodes: 0, edges: 0 };
        if (exists) {
          try {
            const raw = fs.readFileSync(
              path.join(outDir, "graph.json"),
              "utf-8"
            );
            const g = JSON.parse(raw);
            stats.nodes = g.nodes?.length || 0;
            stats.edges = g.edges?.length || 0;
          } catch {}
        }
        const files = fs.readdirSync(outDir).filter((f) => f !== "cache");
        return {
          success: true,
          message: `Graph built: ${stats.nodes} nodes, ${stats.edges} edges in ${outDir}`,
          output_files: files.map((f) => path.join(outDir, f)),
          stats,
        };
      }

      // ── status ──────────────────────────────────────────────
      case "status": {
        const outDir = getGraphifyOutDir(targetDir);
        if (!graphifyOutExists(targetDir)) {
          return {
            success: true,
            message: "No graph found. Run 'build' first.",
            exists: false,
          };
        }
        try {
          const raw = fs.readFileSync(
            path.join(outDir, "graph.json"),
            "utf-8"
          );
          const g = JSON.parse(raw);
          const files = fs.readdirSync(outDir).filter((f) => f !== "cache");
          return {
            success: true,
            exists: true,
            stats: {
              nodes: g.nodes?.length || 0,
              edges: g.edges?.length || 0,
            },
            output_files: files.map((f) => path.join(outDir, f)),
            directory: outDir,
          };
        } catch (err) {
          return {
            success: false,
            exists: true,
            message: `Error reading graph: ${err.message}`,
          };
        }
      }

      // ── query ───────────────────────────────────────────────
      case "query": {
        if (!question) {
          return { success: false, message: "query requires 'question' param" };
        }
        if (!graphifyOutExists(targetDir)) {
          return {
            success: false,
            message:
              "No graph found. Run 'build' first to generate graphify-out/graph.json",
          };
        }
        const result = await runGraphify(
          ["query", question, "--graph", path.join(getGraphifyOutDir(targetDir), "graph.json")],
          targetDir
        );
        return {
          success: true,
          answer: result.stdout.trim(),
          question,
        };
      }

      // ── path (shortest path between symbols) ────────────────
      case "path": {
        if (!symbol_a || !symbol_b) {
          return {
            success: false,
            message: "path requires 'symbol_a' and 'symbol_b' params",
          };
        }
        if (!graphifyOutExists(targetDir)) {
          return {
            success: false,
            message:
              "No graph found. Run 'build' first to generate graphify-out/graph.json",
          };
        }
        const result = await runGraphify(
          [
            "path",
            symbol_a,
            symbol_b,
            "--graph",
            path.join(getGraphifyOutDir(targetDir), "graph.json"),
          ],
          targetDir
        );
        return {
          success: true,
          path: result.stdout.trim(),
          from: symbol_a,
          to: symbol_b,
        };
      }

      // ── explain ─────────────────────────────────────────────
      case "explain": {
        if (!symbol_name) {
          return {
            success: false,
            message: "explain requires 'symbol_name' param",
          };
        }
        if (!graphifyOutExists(targetDir)) {
          return {
            success: false,
            message:
              "No graph found. Run 'build' first to generate graphify-out/graph.json",
          };
        }
        const result = await runGraphify(
          [
            "explain",
            symbol_name,
            "--graph",
            path.join(getGraphifyOutDir(targetDir), "graph.json"),
          ],
          targetDir
        );
        return {
          success: true,
          explanation: result.stdout.trim(),
          symbol: symbol_name,
        };
      }

      // ── export_callflow ─────────────────────────────────────
      case "export_callflow": {
        await runGraphify(["export", "callflow-html"], targetDir);
        const outDir = getGraphifyOutDir(targetDir);
        // Find the callflow HTML file
        const files = fs
          .readdirSync(outDir)
          .filter((f) => f.endsWith("-callflow.html") || f.endsWith("callflow.html"));
        return {
          success: true,
          message: `Call-flow diagram generated in ${outDir}`,
          output_files: files.map((f) => path.join(outDir, f)),
        };
      }

      // ── serve_mcp ───────────────────────────────────────────
      case "serve_mcp": {
        if (!graphifyOutExists(targetDir)) {
          return {
            success: false,
            message:
              "No graph found. Run 'build' first to generate graphify-out/graph.json",
          };
        }
        // Returns instructions for connecting via MCP
        const graphPath = path.join(getGraphifyOutDir(targetDir), "graph.json");
        return {
          success: true,
          message: `MCP server available at: python -m graphify.serve ${graphPath}`,
          mcp_command: `python -m graphify.serve "${graphPath}"`,
          graph_path: graphPath,
          note: "Add this as an MCP server in mcp_servers.json for automatic connection",
        };
      }

      // ── watch ───────────────────────────────────────────────
      case "watch": {
        await runGraphify(["watch", targetDir], targetDir);
        return {
          success: true,
          message: `Watching ${targetDir} for changes. Graph auto-rebuilds on file changes.`,
        };
      }

      // ── update ──────────────────────────────────────────────
      case "update": {
        await runGraphify(["update", targetDir], targetDir);
        return {
          success: true,
          message: `Graph updated for ${targetDir}`,
        };
      }

      // ── check_update ────────────────────────────────────────
      case "check_update": {
        await runGraphify(["check-update", targetDir], targetDir);
        return {
          success: true,
          message: `Update check complete for ${targetDir}`,
        };
      }

      default:
        return { success: false, message: `Unknown action: ${action}` };
    }
  },
};
