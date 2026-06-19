/**
 * ─── Graph Renderer for lv-zero ──────────────────────────────────────────
 *
 * Generates visual graph data from the project's codebase using AST analysis.
 * Produces { nodes, edges } format compatible with Canvas/D3.js rendering.
 *
 * Each file becomes a node, each import/dependency becomes an edge.
 * Supports JS, TS, JSX, TSX, HTML, CSS, and JSON files.
 *
 * v1.0 — June 2026
 *
 * @module graph_renderer
 */

import fs from "fs";
import path from "path";

// ─── Constants ────────────────────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".html", ".css", ".scss", ".json",
]);

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next",
  "coverage", ".lv-zero", "_roo", "graphify-out",
]);

// ═══════════════════════════════════════════════════════════════════════════════
// Graph Renderer
// ═══════════════════════════════════════════════════════════════════════════════

export class GraphRenderer {
  constructor() {
    /** @type {Map<string, object>} nodes: path → { id, label, type, path, size } */
    this._nodes = new Map();

    /** @type {Array<{ source: string, target: string, label: string }>} */
    this._edges = [];

    /** @type {string|null} */
    this._projectPath = null;
  }

  // ─── Properties ────────────────────────────────────────────────────────

  /** @returns {object[]} */
  get nodes() {
    return Array.from(this._nodes.values());
  }

  /** @returns {object[]} */
  get edges() {
    return this._edges;
  }

  /** @returns {number} */
  get nodeCount() {
    return this._nodes.size;
  }

  /** @returns {number} */
  get edgeCount() {
    return this._edges.length;
  }

  // ─── Build ─────────────────────────────────────────────────────────────

  /**
   * Builds the graph from a project directory.
   *
   * @param {string} projectPath - Path to the project root
   * @returns {{ nodes: object[], edges: object[], stats: { files: number, imports: number, dirs: number } }}
   */
  async build(projectPath) {
    this._projectPath = path.resolve(projectPath);
    this._nodes.clear();
    this._edges = [];

    if (!fs.existsSync(this._projectPath)) {
      return { nodes: [], edges: [], stats: { files: 0, imports: 0, dirs: 0 } };
    }

    // Phase 1: Walk directory and create nodes
    const dirs = new Set();
    await this._walkDir(this._projectPath, this._projectPath, dirs);

    // Phase 2: Analyze imports for edges
    await this._analyzeImports(this._projectPath);

    // Phase 3: Add directory nodes for structure
    for (const dirPath of dirs) {
      if (!this._nodes.has(dirPath)) {
        const dirName = path.basename(dirPath);
        const relPath = path.relative(this._projectPath, dirPath);
        this._nodes.set(dirPath, {
          id: dirPath,
          label: dirName,
          path: relPath,
          type: "directory",
          size: 0,
          children: this._countChildren(dirPath),
        });
      }
    }

    return {
      nodes: this.nodes,
      edges: this.edges,
      stats: {
        files: this.nodes.filter((n) => n.type === "file").length,
        imports: this.edges.length,
        dirs: this.nodes.filter((n) => n.type === "directory").length,
      },
    };
  }

  /**
   * Adds a single file to the graph (useful when agent creates a new file).
   *
   * @param {string} filePath - Path to the new file
   * @returns {boolean} Whether the node was added
   */
  addFile(filePath) {
    const resolvedPath = path.resolve(filePath);
    if (this._nodes.has(resolvedPath)) return false;

    const ext = path.extname(resolvedPath);
    if (!SUPPORTED_EXTENSIONS.has(ext)) return false;

    const relPath = path.relative(this._projectPath || path.dirname(resolvedPath), resolvedPath);
    const stats = fs.existsSync(resolvedPath) ? fs.statSync(resolvedPath) : null;

    this._nodes.set(resolvedPath, {
      id: resolvedPath,
      label: path.basename(resolvedPath),
      path: relPath,
      type: "file",
      ext: ext,
      size: stats?.size || 0,
      language: this._detectLanguage(ext),
    });

    return true;
  }

  /**
   * Removes a file from the graph.
   *
   * @param {string} filePath
   */
  removeFile(filePath) {
    const resolvedPath = path.resolve(filePath);
    this._nodes.delete(resolvedPath);
    this._edges = this._edges.filter(
      (e) => e.source !== resolvedPath && e.target !== resolvedPath
    );
  }

  /**
   * Returns the graph data in a format suitable for Canvas rendering.
   *
   * @returns {object}
   */
  getGraphData() {
    return {
      nodes: this.nodes,
      edges: this.edges,
      stats: {
        files: this.nodes.filter((n) => n.type === "file").length,
        imports: this.edges.length,
        dirs: this.nodes.filter((n) => n.type === "directory").length,
      },
    };
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  /**
   * Walks a directory recursively, creating nodes for each file.
   */
  async _walkDir(dirPath, basePath, dirs) {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
            dirs.add(fullPath);
            await this._walkDir(fullPath, basePath, dirs);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (SUPPORTED_EXTENSIONS.has(ext)) {
            const relPath = path.relative(basePath, fullPath);
            const stats = fs.statSync(fullPath);

            this._nodes.set(fullPath, {
              id: fullPath,
              label: entry.name,
              path: relPath,
              type: "file",
              ext: ext,
              size: stats.size,
              language: this._detectLanguage(ext),
            });
          }
        }
      }
    } catch {
      // Permission errors or missing dirs — skip silently
    }
  }

  /**
   * Analyzes imports in JS/TS files to create edges.
   */
  async _analyzeImports(basePath) {
    const importPattern = /(?:import\s+(?:[\w*\s{},]*)\s+from\s+['"])([^'"]+)(?:['"]|require\s*\(\s*['"])([^'"]+)(?:['"]\s*\))/g;

    for (const [filePath, node] of this._nodes) {
      if (node.type !== "file") continue;
      if (!node.ext || ![".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(node.ext)) continue;

      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const imports = this._extractImports(content);

        for (const importPath of imports) {
          // Resolve relative imports to absolute paths
          if (importPath.startsWith(".") || importPath.startsWith("..")) {
            const resolvedImport = path.resolve(path.dirname(filePath), importPath);

            // Try common extensions
            const extensions = ["", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", "/index.js", "/index.ts"];
            for (const ext of extensions) {
              const candidate = resolvedImport + ext;
              if (this._nodes.has(candidate)) {
                this._edges.push({
                  source: filePath,
                  target: candidate,
                  label: "imports",
                });
                break;
              }
            }
          }
          // Skip external packages (node_modules) — they're not in our graph
        }
      } catch {
        // Skip files that can't be read
      }
    }
  }

  /**
   * Extracts import paths from source code.
   *
   * @param {string} content - File content
   * @returns {string[]} Import paths
   */
  _extractImports(content) {
    const imports = [];
    const patterns = [
      // ES6 imports: import ... from '...'
      /import\s+(?:[\w*\s{},]*)\s+from\s+['"]([^'"]+)['"]/g,
      // Dynamic imports: import('...')
      /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      // require: require('...')
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      // CSS/HTML imports: @import '...'
      /@import\s+['"]([^'"]+)['"]/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const importPath = match[1].trim();
        // Filter out URLs and node_modules packages
        if (!importPath.startsWith("http") && !importPath.startsWith("https")) {
          imports.push(importPath);
        }
      }
    }

    return imports;
  }

  /**
   * Detects the programming language from file extension.
   */
  _detectLanguage(ext) {
    const map = {
      ".js": "JavaScript",
      ".jsx": "React JSX",
      ".ts": "TypeScript",
      ".tsx": "React TSX",
      ".mjs": "ES Module",
      ".cjs": "CommonJS",
      ".html": "HTML",
      ".css": "CSS",
      ".scss": "SCSS",
      ".json": "JSON",
    };
    return map[ext] || "Unknown";
  }

  /**
   * Counts the number of children in a directory.
   */
  _countChildren(dirPath) {
    try {
      return fs.readdirSync(dirPath).length;
    } catch {
      return 0;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════════

/** @type {GraphRenderer|null} */
let _defaultInstance = null;

/**
 * Gets or creates the default GraphRenderer instance.
 * @returns {GraphRenderer}
 */
export function getGraphRenderer() {
  if (!_defaultInstance) {
    _defaultInstance = new GraphRenderer();
  }
  return _defaultInstance;
}
