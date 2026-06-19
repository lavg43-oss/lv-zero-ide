/**
 * graphify_explorer — Code Knowledge Graph for LV-Zero
 *
 * Uses graphify-ts (tree-sitter WASM) to extract AST-level knowledge graphs
 * from the project codebase. Enables semantic code navigation:
 *  - Build a graph index of all symbols and their relationships
 *  - Find callers/callees of any function
 *  - Query symbols by name across the project
 *  - Find shortest path between two symbols
 *  - Get all symbols defined in a file
 *
 * v1.0 — Graphify integration
 */
import { execFile } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const WORKER_PATH = path.join(PROJECT_ROOT, "_lib", "graphify_worker.mjs");
const DEFAULT_GRAPH_DIR = path.join(PROJECT_ROOT, ".graphify");

// ── Ensure graph directory exists ─────────────────────────────────────
function ensureGraphDir() {
  if (!fs.existsSync(DEFAULT_GRAPH_DIR)) {
    fs.mkdirSync(DEFAULT_GRAPH_DIR, { recursive: true });
  }
}

// ── Run graphify worker as subprocess ─────────────────────────────────
function runWorker(...args) {
  return new Promise((resolve, reject) => {
    const workerArgs = [WORKER_PATH, ...args];

    // Use npx tsx to run the TypeScript worker
    const child = execFile(
      process.execPath, // Use the same Node.js binary
      ["--no-warnings", ...workerArgs],
      {
        cwd: PROJECT_ROOT,
        maxBuffer: 50 * 1024 * 1024, // 50MB output buffer
        env: {
          ...process.env,
          NODE_NO_WARNINGS: "1",
        },
        timeout: 120000, // 2 min timeout
      },
      (error, stdout, stderr) => {
        if (error) {
          // Try with npx tsx as fallback
          return runWithTsx(args)
            .then(resolve)
            .catch(reject);
        }
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch (parseErr) {
          reject(new Error(`Failed to parse worker output: ${parseErr.message}\nRaw: ${stdout.slice(0, 500)}`));
        }
      }
    );
  });
}

// ── Fallback: run with npx tsx ────────────────────────────────────────
function runWithTsx(args) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "npx",
      ["tsx", WORKER_PATH, ...args],
      {
        cwd: PROJECT_ROOT,
        maxBuffer: 50 * 1024 * 1024,
        timeout: 120000,
      },
      (error, stdout, stderr) => {
        if (error) {
          // Try node --import tsx
          return runWithTsxImport(args)
            .then(resolve)
            .catch((e) => reject(new Error(`Worker failed: ${e.message}\nStderr: ${stderr.slice(0, 500)}`)));
        }
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch (parseErr) {
          reject(new Error(`Failed to parse worker output: ${parseErr.message}`));
        }
      }
    );
  });
}

// ── Fallback 2: run with node --import tsx/esm ────────────────────────
function runWithTsxImport(args) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      ["--import", "tsx/esm", "--no-warnings", WORKER_PATH, ...args],
      {
        cwd: PROJECT_ROOT,
        maxBuffer: 50 * 1024 * 1024,
        timeout: 120000,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Worker failed: ${error.message}\nStderr: ${stderr.slice(0, 300)}`));
          return;
        }
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch (parseErr) {
          reject(new Error(`Failed to parse: ${parseErr.message}`));
        }
      }
    );
  });
}

// ── Skill Definition ──────────────────────────────────────────────────

export default {
  name: "graphify_explorer",
  description:
    "Code Knowledge Graph — Builds an AST-level graph of your project's symbols " +
    "(functions, classes, imports, variables) and lets you query relationships between them. " +
    "Useful for: finding what calls a function, where symbols are defined, " +
    "shortest path between two pieces of code, and getting all symbols in a file. " +
    "Supported languages: JavaScript, TypeScript, Python, Ruby, Go, Rust, Java, Kotlin, PHP, C, C#, Scala.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["build", "query", "callers", "callees", "symbols", "path", "stats", "languages"],
        description:
          '"build": Build/rebuild the full code graph for a directory. ' +
          '"query": Search for symbols by name. ' +
          '"callers": Find all functions that call a given symbol. ' +
          '"callees": Find all functions called by a given symbol. ' +
          '"symbols": List all symbols defined in a specific file. ' +
          '"path": Find shortest path between two symbols. ' +
          '"stats": Show graph statistics (files, nodes, edges). ' +
          '"languages": List supported programming languages.',
      },
      dir: {
        type: "string",
        description:
          "(build) Directory to scan. Defaults to project root.",
      },
      query: {
        type: "string",
        description:
          "(query) Symbol name or pattern to search for (e.g. 'loadSystemPrompt', 'handleCreate', 'Orchestrator').",
      },
      symbol: {
        type: "string",
        description:
          "(callers/callees/path) Symbol ID to analyze. Format: file.ts:ClassName.methodName or just functionName.",
      },
      symbolB: {
        type: "string",
        description:
          "(path) Second symbol ID to find shortest path to.",
      },
      file: {
        type: "string",
        description:
          "(symbols) File path to list symbols from. Relative to project root (e.g. 'src/core/orchestrator.js').",
      },
      rebuild: {
        type: "boolean",
        description:
          "(build) Force rebuild even if graph exists.",
        default: false,
      },
    },
    required: ["action"],
  },

  handler: async ({ action, dir, query, symbol, symbolB, file, rebuild }) => {
    try {
      ensureGraphDir();
      const graphPath = path.join(DEFAULT_GRAPH_DIR, "graph.json");

      switch (action) {
        // ── BUILD ─────────────────────────────────────────────────────
        case "build": {
          const targetDir = dir
            ? path.resolve(PROJECT_ROOT, dir)
            : PROJECT_ROOT;

          // Check if graph exists and skip if not forced
          if (!rebuild && fs.existsSync(graphPath)) {
            const stats = JSON.parse(fs.readFileSync(graphPath, "utf-8")).metadata;
            return {
              success: true,
              message: `Graph already exists at ${graphPath}`,
              stats,
              hint: "Use rebuild: true to force rebuild.",
            };
          }

          const result = await runWorker("build", targetDir, DEFAULT_GRAPH_DIR);
          return {
            success: true,
            message: `Code graph built for ${result.metadata.files} files`,
            stats: result.metadata,
            graphPath,
          };
        }

        // ── QUERY ─────────────────────────────────────────────────────
        case "query": {
          if (!query) return { success: false, error: "query parameter is required for action: query" };
          if (!fs.existsSync(graphPath)) {
            return { success: false, error: "No graph found. Run build action first.", hint: "Run graphify_explorer with action: 'build'" };
          }
          const results = await runWorker("query", graphPath, query);
          return {
            success: true,
            query,
            matches: results.length,
            symbols: results.map((r) => ({
              name: r.label,
              file: r.sourceFile,
              location: r.sourceLocation,
              type: r.fileType,
            })),
          };
        }

        // ── CALLERS ───────────────────────────────────────────────────
        case "callers": {
          if (!symbol) return { success: false, error: "symbol parameter is required for action: callers" };
          if (!fs.existsSync(graphPath)) {
            return { success: false, error: "No graph found. Run build action first." };
          }
          const results = await runWorker("callers", graphPath, symbol);
          return {
            success: true,
            symbol,
            callers: results.length,
            callersList: results.map((r) => ({
              id: r.id,
              label: r.label,
              file: r.sourceFile,
              location: r.sourceLocation,
            })),
          };
        }

        // ── CALLEES ───────────────────────────────────────────────────
        case "callees": {
          if (!symbol) return { success: false, error: "symbol parameter is required for action: callees" };
          if (!fs.existsSync(graphPath)) {
            return { success: false, error: "No graph found. Run build action first." };
          }
          const results = await runWorker("callees", graphPath, symbol);
          return {
            success: true,
            symbol,
            callees: results.length,
            calleesList: results.map((r) => ({
              id: r.id,
              label: r.label,
              file: r.sourceFile,
              location: r.sourceLocation,
            })),
          };
        }

        // ── SYMBOLS ───────────────────────────────────────────────────
        case "symbols": {
          if (!file) return { success: false, error: "file parameter is required for action: symbols" };
          if (!fs.existsSync(graphPath)) {
            return { success: false, error: "No graph found. Run build action first." };
          }
          const absPath = path.resolve(PROJECT_ROOT, file);
          const results = await runWorker("symbols", graphPath, absPath);
          return {
            success: true,
            file,
            symbols: results.length,
            symbolsList: results.map((r) => ({
              id: r.id,
              label: r.label,
              location: r.sourceLocation,
              type: r.fileType,
            })),
          };
        }

        // ── PATH ──────────────────────────────────────────────────────
        case "path": {
          if (!symbol || !symbolB) {
            return { success: false, error: "symbol and symbolB parameters are required for action: path" };
          }
          if (!fs.existsSync(graphPath)) {
            return { success: false, error: "No graph found. Run build action first." };
          }
          const results = await runWorker("path", graphPath, symbol, symbolB);
          return {
            success: true,
            from: symbol,
            to: symbolB,
            path: results,
            pathLength: Array.isArray(results) ? results.length : "unknown",
          };
        }

        // ── STATS ─────────────────────────────────────────────────────
        case "stats": {
          if (!fs.existsSync(graphPath)) {
            return { success: false, error: "No graph found. Run build action first." };
          }
          const stats = await runWorker("stats", graphPath);
          return {
            success: true,
            stats,
          };
        }

        // ── LANGUAGES ─────────────────────────────────────────────────
        case "languages": {
          const result = await runWorker("languages");
          return {
            success: true,
            languages: result.languages,
            count: result.count,
          };
        }

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (err) {
      return {
        success: false,
        error: err.message,
        hint: "Make sure graphify-ts and tsx are installed. Run: npm install graphify-ts tsx",
      };
    }
  },
};
