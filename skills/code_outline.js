/**
 * lv-zero — Code Outline Skill
 *
 * v1.0 — May 2026
 *   Middleware de ahorro de tokens: devuelve SOLO firmas de funciones,
 *   clases, imports y exports de un archivo, sin la lógica interna.
 *   El agente debe usar esta skill ANTES de read_file para saber
 *   exactamente qué líneas necesita leer.
 *
 *   Soporta: JavaScript, TypeScript, Python, HTML, CSS, JSON, Markdown.
 *
 * Uso desde el LLM (tool call):
 *   { "path": "src/core/orchestrator.js" }
 *
 * Respuesta:
 *   { success: true, path: "...", totalLines: 4261, outline: [
 *       { type: "import", line: 25, text: "import fs from 'fs';" },
 *       { type: "class", line: 106, text: "class Orchestrator extends EventEmitter {" },
 *       { type: "function", line: 1576, text: "async agentLoop(userInput) {" },
 *       ...
 *     ], summary: "42 elementos en 4261 líneas" }
 */

import fs from "fs";
import path from "path";
import { resolveSafePath, getProjectRoot } from "./path_resolver.js";

// ─── Configuration ──────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB max for outline scanning

// ═══════════════════════════════════════════════════════════════════════════════
// Language-specific extractors
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract outline for JS/TS files.
 */
function extractJSOutline(lines) {
  const outline = [];
  const startMarkers = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      continue;
    }

    // ── Import / export statements ──────────────────────────────────────
    if (/^(import|export)\s+.*(from\s+['"]|require\()/i.test(trimmed) ||
        /^export\s+(default\s+|const|let|var|function|class|async)/.test(trimmed) ||
        /^module\.exports/.test(trimmed)) {
      const key = `import:${lineNum}`;
      if (!startMarkers.has(key)) {
        outline.push({ type: "import/export", line: lineNum, text: trimmed.substring(0, 150) });
        startMarkers.add(key);
      }
      continue;
    }

    // ── Class declarations ──────────────────────────────────────────────
    if (/^\s*(export\s+)?(abstract\s+)?class\s+\w+/.test(trimmed)) {
      const key = `class:${lineNum}`;
      if (!startMarkers.has(key)) {
        const name = trimmed.match(/class\s+(\w+)/)?.[1] || "unknown";
        outline.push({ type: "class", line: lineNum, name, text: trimmed.substring(0, 150) });
        startMarkers.add(key);
      }
      continue;
    }

    // ── Function / method declarations ──────────────────────────────────
    if (/^\s*(export\s+)?(async\s+)?function\s+\w+/.test(trimmed)) {
      const key = `function:${lineNum}`;
      if (!startMarkers.has(key)) {
        const name = trimmed.match(/function\s+(\w+)/)?.[1] || "anonymous";
        outline.push({ type: "function", line: lineNum, name, text: trimmed.substring(0, 150) });
        startMarkers.add(key);
      }
      continue;
    }

    // ── Class methods (async? name(params) {) ──────────────────────────
    if (/^\s{2,}(static\s+)?(async\s+)?\w+\s*\([^)]*\)\s*\{/.test(trimmed) &&
        !trimmed.startsWith("if") && !trimmed.startsWith("for") &&
        !trimmed.startsWith("while") && !trimmed.startsWith("switch") &&
        !trimmed.startsWith("try") && !trimmed.startsWith("catch")) {
      const key = `method:${lineNum}`;
      if (!startMarkers.has(key)) {
        const name = trimmed.match(/(\w+)\s*\(/)?.[1] || "unknown";
        outline.push({ type: "method", line: lineNum, name, text: trimmed.substring(0, 120) });
        startMarkers.add(key);
      }
      continue;
    }

    // ── Arrow function assignments (const name = (params) => {) ────────
    if (/^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s*)?\([^)]*\)\s*=>/.test(trimmed)) {
      const key = `arrow:${lineNum}`;
      if (!startMarkers.has(key)) {
        const name = trimmed.match(/(const|let|var)\s+(\w+)/)?.[2] || "unknown";
        outline.push({ type: "arrow-function", line: lineNum, name, text: trimmed.substring(0, 150) });
        startMarkers.add(key);
      }
      continue;
    }
  }

  return outline;
}

/**
 * Extract outline for Python files.
 */
function extractPythonOutline(lines) {
  const outline = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) continue;

    // Imports
    if (/^(import|from)\s+\w+/.test(trimmed)) {
      outline.push({ type: "import", line: lineNum, text: trimmed.substring(0, 150) });
      continue;
    }

    // Class
    if (/^class\s+\w+/.test(trimmed)) {
      const name = trimmed.match(/class\s+(\w+)/)?.[1] || "unknown";
      outline.push({ type: "class", line: lineNum, name, text: trimmed.substring(0, 150) });
      continue;
    }

    // Function / async def
    if (/^(async\s+)?def\s+\w+/.test(trimmed)) {
      const name = trimmed.match(/def\s+(\w+)/)?.[1] || "unknown";
      outline.push({ type: "function", line: lineNum, name, text: trimmed.substring(0, 150) });
      continue;
    }
  }

  return outline;
}

/**
 * Extract outline for Markdown files (headings only).
 */
function extractMarkdownOutline(lines) {
  const outline = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    if (/^#{1,6}\s+\S/.test(trimmed)) {
      const level = trimmed.match(/^(#{1,6})/)[1].length;
      const text = trimmed.replace(/^#{1,6}\s*/, "").substring(0, 120);
      outline.push({ type: "heading", line: lineNum, level, text });
    }
  }

  return outline;
}

/**
 * Extract outline for HTML files (tags + structure).
 */
function extractHTMLOutline(lines) {
  const outline = [];
  const content = lines.join("\n");

  // Match opening tags with id or class
  const tagRegex = /<(\w+)([^>]*?)(?:\sid\s*=\s*["']([^"']+)["'])?([^>]*)>/gi;
  let match;

  while ((match = tagRegex.exec(content)) !== null) {
    const tag = match[1];
    const id = match[3];
    const fullMatch = match[0];
    const lineNum = content.substring(0, match.index).split("\n").length;

    if (tag === "script" || tag === "style") {
      outline.push({ type: "tag", line: lineNum, tag, text: `<${tag}>`, inline: true });
    } else if (id) {
      outline.push({ type: "tag", line: lineNum, tag, id, text: fullMatch.substring(0, 120) });
    } else if (["head", "body", "main", "section", "header", "footer", "nav", "div", "form"].includes(tag)) {
      outline.push({ type: "tag", line: lineNum, tag, text: fullMatch.substring(0, 120) });
    }
  }

  return outline;
}

/**
 * Extract outline for CSS files (selectors only, no properties).
 */
function extractCSSOutline(lines) {
  const outline = [];
  const content = lines.join("\n");

  // Match CSS rule selectors (before the opening brace)
  const ruleRegex = /([^{}]+?)\s*\{/g;
  let match;

  while ((match = ruleRegex.exec(content)) !== null) {
    const selector = match[1].trim();
    if (!selector || selector.startsWith("@")) continue; // Skip at-rules and empty
    const lineNum = content.substring(0, match.index).split("\n").length;
    outline.push({ type: "selector", line: lineNum, text: selector.substring(0, 150) });
  }

  // Match at-rules
  const atRuleRegex = /@(\w+)[^{;]*/g;
  while ((match = atRuleRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split("\n").length;
    outline.push({ type: "at-rule", line: lineNum, text: match[0].trim().substring(0, 120) });
  }

  return outline;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main extractor
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Select the appropriate extractor based on file extension.
 */
function selectExtractor(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  const map = {
    ".js": extractJSOutline,
    ".mjs": extractJSOutline,
    ".cjs": extractJSOutline,
    ".ts": extractJSOutline,
    ".jsx": extractJSOutline,
    ".tsx": extractJSOutline,
    ".py": extractPythonOutline,
    ".md": extractMarkdownOutline,
    ".html": extractHTMLOutline,
    ".htm": extractHTMLOutline,
    ".css": extractCSSOutline,
    ".scss": extractCSSOutline,
    ".less": extractCSSOutline,
  };

  return map[ext] || null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Skill Definition
// ═══════════════════════════════════════════════════════════════════════════════

export default {
  name: "get_code_outline",
  description:
    "Devuelve SOLO las firmas de funciones, clases, imports y exports de un archivo, SIN la lógica interna. " +
    "Úsalo SIEMPRE antes de read_file para saber la estructura del archivo y elegir exactamente qué líneas leer. " +
    "Ahorra ~90% de tokens vs leer el archivo completo. " +
    "Soporta JS, TS, Python, HTML, CSS, Markdown.",

  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          'Ruta del archivo (relativa al proyecto raíz). Ejemplo: "src/core/orchestrator.js".',
      },
    },
    required: ["path"],
  },

  handler: async ({ path: filePath }) => {
    // ── Security: resolve safe path ─────────────────────────────────────
    let safePath;
    try {
      safePath = resolveSafePath(filePath);
    } catch (traversalErr) {
      return {
        success: false,
        error: traversalErr.message,
        path: filePath,
      };
    }

    // ── Validate file exists ────────────────────────────────────────────
    if (!fs.existsSync(safePath)) {
      return {
        success: false,
        error: `Archivo no encontrado: "${filePath}"`,
        path: filePath,
      };
    }

    const stat = fs.statSync(safePath);
    if (stat.isDirectory()) {
      return {
        success: false,
        error: `"${filePath}" es un directorio, no un archivo.`,
        path: filePath,
      };
    }

    // ── Size guard ──────────────────────────────────────────────────────
    if (stat.size > MAX_FILE_SIZE) {
      return {
        success: false,
        error: `Archivo demasiado grande (${(stat.size / 1024 / 1024).toFixed(1)}MB). Máximo: ${MAX_FILE_SIZE / 1024 / 1024}MB.`,
        path: filePath,
      };
    }

    // ── Select extractor ────────────────────────────────────────────────
    const extractor = selectExtractor(safePath);
    if (!extractor) {
      const ext = path.extname(safePath).toLowerCase();
      return {
        success: false,
        error: `Tipo de archivo no soportado para outline: "${ext}". Usa read_file con start_line/end_line.`,
        path: filePath,
        supportedExtensions: [".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx", ".py", ".md", ".html", ".css", ".scss"],
      };
    }

    // ── Read and extract outline ────────────────────────────────────────
    try {
      const buffer = fs.readFileSync(safePath);
      const content = buffer.toString("utf-8");
      const lines = content.split(/\r?\n/);
      const outline = extractor(lines);

      // Deduplicate by line number
      const seen = new Set();
      const deduped = outline.filter(item => {
        const key = `${item.type}:${item.line}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return {
        success: true,
        path: filePath,
        totalLines: lines.length,
        size: stat.size,
        outline: deduped,
        summary: `${deduped.length} elementos encontrados en ${lines.length} líneas (${(stat.size / 1024).toFixed(1)}KB)`,
      };
    } catch (err) {
      return {
        success: false,
        error: `Error leyendo archivo: ${err.message}`,
        path: filePath,
      };
    }
  },
};
