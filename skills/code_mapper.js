/**
 * lv-zero — CodeMapper (Visión AST)
 *
 * v1.0
 *   Usa acorn + acorn-loose para parsear código JS/TS/JSX y extraer:
 *     - Imports (import ... from "...")
 *     - Function signatures (function name, params, async, generator)
 *     - Arrow functions (const fn = (...) => ...)
 *     - Class declarations
 *     - Exports (export default, export const, export function)
 *     - Top-level const/let/var declarations
 *   Sin consumir tokens leyendo el archivo completo (solo parsea cabeceras/estructura).
 */

import fs from "fs";
import path from "path";

// Dynamic imports for acorn (will be lazily loaded)
let acorn = null;
let acornLoose = null;

/**
 * Carga acorn de forma perezosa.
 */
async function ensureParser() {
  if (!acorn) {
    try {
      acorn = await import("acorn");
    } catch (_) {
      // Fallback: acorn not installed, will use regex parser
      console.warn("   ⚠️  acorn no instalado. Usando parser regex.");
    }
  }
  if (!acornLoose) {
    try {
      acornLoose = await import("acorn-loose");
    } catch (_) {
      // Optional dependency
    }
  }
}

// ─── Regex Parser (fallback when acorn is not available) ──────────────────

/**
 * Extrae imports usando regex.
 */
function extractImportsRegex(source) {
  const imports = [];
  const patterns = [
    // import default from 'module'
    /import\s+(\w+(?:\s*,\s*\{[^}]+\})?)\s+from\s+['"]([^'"]+)['"]/g,
    // import { ... } from 'module'
    /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g,
    // import * as name from 'module'
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
    // import 'module' (side-effect)
    /import\s+['"]([^'"]+)['"]/g,
    // require('module')
    /(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      imports.push({
        type: "import",
        source: match[match.length - 1], // last group is always module path
        specifier: match.length > 2 ? match[1] : null,
        line: source.substring(0, match.index).split("\n").length,
      });
    }
  }

  return imports;
}

/**
 * Extrae function signatures usando regex.
 */
function extractFunctionsRegex(source) {
  const functions = [];
  const lines = source.split("\n");

  // async function name(params) or function name(params)
  const funcRegex =
    /^(?:export\s+)?(?:async\s+)?function\s*(?:\*\s*)?(\w+)\s*\(([^)]*)\)/gm;
  let match;
  while ((match = funcRegex.exec(source)) !== null) {
    const lineNum = source.substring(0, match.index).split("\n").length;
    functions.push({
      type: "function",
      name: match[1],
      params: match[2]
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean),
      async: match[0].includes("async"),
      generator: match[0].includes("*"),
      line: lineNum,
    });
  }

  // Arrow functions: const fn = (...) => ...
  const arrowRegex =
    /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?:\s*:\s*\w+)?\s*=>/gm;
  while ((match = arrowRegex.exec(source)) !== null) {
    const lineNum = source.substring(0, match.index).split("\n").length;
    functions.push({
      type: "arrow",
      name: match[1],
      params: match[2]
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean),
      async: match[0].includes("async"),
      line: lineNum,
    });
  }

  // Arrow functions with single param (no parens): const fn = param => ...
  const singleArrowRegex =
    /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(\w+)\s*=>/gm;
  while ((match = singleArrowRegex.exec(source)) !== null) {
    const lineNum = source.substring(0, match.index).split("\n").length;
    // Avoid matching if already captured
    if (!functions.find((f) => f.name === match[1] && f.line === lineNum)) {
      functions.push({
        type: "arrow",
        name: match[1],
        params: [match[2]],
        async: match[0].includes("async"),
        line: lineNum,
      });
    }
  }

  // Method shorthand in objects/classes: methodName(params) { ... }
  const methodRegex =
    /^(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*\(([^)]*)\)\s*\{/gm;
  while ((match = methodRegex.exec(source)) !== null) {
    const lineNum = source.substring(0, match.index).split("\n").length;
    const beforeText = source.substring(0, match.index);
    // Only capture if it's inside a class/object (not global function)
    const lastBrace = beforeText.lastIndexOf("{");
    const lastBracket = beforeText.lastIndexOf("}");
    const context = beforeText.substring(Math.max(0, beforeText.length - 200));
    if (context.includes("class ") || context.includes("= {")) {
      functions.push({
        type: "method",
        name: match[1],
        params: match[2]
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
        async: match[0].includes("async"),
        line: lineNum,
      });
    }
  }

  return functions;
}

/**
 * Extrae exports usando regex.
 */
function extractExportsRegex(source) {
  const exports = [];
  const lines = source.split("\n");

  // export default ...
  const defaultExportRegex = /export\s+default\s+(\w+|class\s+\w+|function\s+\w+)/g;
  let match;
  while ((match = defaultExportRegex.exec(source)) !== null) {
    const lineNum = source.substring(0, match.index).split("\n").length;
    exports.push({
      type: "default",
      value: match[1],
      line: lineNum,
    });
  }

  // export const/let/var ...
  const namedExportRegex = /export\s+(?:const|let|var)\s+(\w+)/g;
  while ((match = namedExportRegex.exec(source)) !== null) {
    const lineNum = source.substring(0, match.index).split("\n").length;
    exports.push({
      type: "named",
      name: match[1],
      line: lineNum,
    });
  }

  // export function ...
  const funcExportRegex = /export\s+(?:async\s+)?function\s+(\w+)/g;
  while ((match = funcExportRegex.exec(source)) !== null) {
    const lineNum = source.substring(0, match.index).split("\n").length;
    exports.push({
      type: "named",
      name: match[1],
      line: lineNum,
    });
  }

  // export class ...
  const classExportRegex = /export\s+(?:default\s+)?class\s+(\w+)/g;
  while ((match = classExportRegex.exec(source)) !== null) {
    const lineNum = source.substring(0, match.index).split("\n").length;
    exports.push({
      type: match[0].includes("default") ? "default" : "named",
      name: match[1],
      line: lineNum,
    });
  }

  // export { ... }
  const namedExportListRegex = /export\s+\{([^}]+)\}/g;
  while ((match = namedExportListRegex.exec(source)) !== null) {
    const lineNum = source.substring(0, match.index).split("\n").length;
    const names = match[1]
      .split(",")
      .map((n) => {
        const parts = n.trim().split(/\s+as\s+/);
        return parts[0].trim();
      })
      .filter(Boolean);
    for (const name of names) {
      exports.push({
        type: "named",
        name,
        line: lineNum,
      });
    }
  }

  return exports;
}

/**
 * Extrae clases usando regex.
 */
function extractClassesRegex(source) {
  const classes = [];
  // class Name extends Parent { ... }
  const classRegex =
    /(?:export\s+(?:default\s+)?)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/g;
  let match;
  while ((match = classRegex.exec(source)) !== null) {
    const lineNum = source.substring(0, match.index).split("\n").length;
    classes.push({
      name: match[1],
      extends: match[2] || null,
      implements: match[3] ? match[3].trim() : null,
      line: lineNum,
    });
  }
  return classes;
}

/**
 * Extrae top-level declarations (const, let, var) usando regex.
 */
function extractDeclarationsRegex(source) {
  const declarations = [];
  const declRegex =
    /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*\w+)?\s*=(?!=)/gm;
  let match;
  while ((match = declRegex.exec(source)) !== null) {
    const lineNum = source.substring(0, match.index).split("\n").length;
    const beforeText = source.substring(0, match.index);
    // Only capture top-level (not inside functions/blocks)
    const openBraces = (beforeText.match(/\{/g) || []).length;
    const closeBraces = (beforeText.match(/\}/g) || []).length;
    if (openBraces <= closeBraces + 1) {
      declarations.push({
        name: match[1],
        keyword: match[0].includes("const")
          ? "const"
          : match[0].includes("let")
          ? "let"
          : "var",
        line: lineNum,
      });
    }
  }
  return declarations;
}

// ─── AST Parser (acorn) ────────────────────────────────────────────────────

/**
 * Extrae imports usando AST (acorn).
 */
function extractImportsAST(ast) {
  const imports = [];
  if (!ast || !ast.body) return imports;

  for (const node of ast.body) {
    if (node.type === "ImportDeclaration") {
      const specifiers = node.specifiers.map((s) => {
        if (s.type === "ImportDefaultSpecifier") return s.local.name;
        if (s.type === "ImportNamespaceSpecifier") return `* as ${s.local.name}`;
        return s.imported?.name || s.local.name;
      });
      imports.push({
        type: "import",
        source: node.source.value,
        specifiers,
        line: node.loc?.start?.line || 0,
      });
    }
  }
  return imports;
}

/**
 * Extrae funciones usando AST (acorn).
 */
function extractFunctionsAST(ast) {
  const functions = [];
  if (!ast || !ast.body) return functions;

  function walkNode(node) {
    if (!node) return;

    // FunctionDeclaration
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression"
    ) {
      if (node.id) {
        functions.push({
          type: node.type === "FunctionDeclaration" ? "function" : "expression",
          name: node.id.name,
          params: (node.params || []).map((p) =>
            p.type === "Identifier" ? p.name : p.type
          ),
          async: node.async || false,
          generator: node.generator || false,
          line: node.loc?.start?.line || 0,
        });
      }
    }

    // ArrowFunctionExpression assigned to VariableDeclarator
    if (node.type === "VariableDeclarator" && node.init) {
      if (
        node.init.type === "ArrowFunctionExpression" ||
        node.init.type === "FunctionExpression"
      ) {
        if (node.id) {
          functions.push({
            type: "arrow",
            name: node.id.name,
            params: (node.init.params || []).map((p) =>
              p.type === "Identifier" ? p.name : p.type
            ),
            async: node.init.async || false,
            line: node.loc?.start?.line || 0,
          });
        }
      }
    }

    // ClassDeclaration
    if (node.type === "ClassDeclaration" && node.body?.body) {
      for (const method of node.body.body) {
        if (method.type === "MethodDefinition") {
          functions.push({
            type: "method",
            name: method.key?.name || "(computed)",
            params: (method.value?.params || []).map((p) =>
              p.type === "Identifier" ? p.name : p.type
            ),
            async: method.value?.async || false,
            static: method.static || false,
            kind: method.kind || "method",
            line: method.loc?.start?.line || 0,
          });
        }
      }
    }

    // Recurse into child nodes
    for (const key of Object.keys(node)) {
      if (key === "parent") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c.type === "string") walkNode(c);
        }
      } else if (child && typeof child.type === "string") {
        walkNode(child);
      }
    }
  }

  for (const node of ast.body) {
    walkNode(node);
  }

  return functions;
}

/**
 * Extrae exports usando AST (acorn).
 */
function extractExportsAST(ast) {
  const exports = [];
  if (!ast || !ast.body) return exports;

  for (const node of ast.body) {
    if (node.type === "ExportDefaultDeclaration") {
      const name =
        node.declaration?.id?.name ||
        node.declaration?.name ||
        (node.declaration?.type === "FunctionDeclaration"
          ? "(anonymous function)"
          : "(anonymous)");
      exports.push({
        type: "default",
        value: name,
        line: node.loc?.start?.line || 0,
      });
    }

    if (node.type === "ExportNamedDeclaration") {
      if (node.declaration) {
        const name =
          node.declaration?.id?.name ||
          (node.declaration?.declarations?.[0]?.id?.name) ||
          "(unknown)";
        exports.push({
          type: "named",
          name,
          line: node.loc?.start?.line || 0,
        });
      }
      if (node.specifiers) {
        for (const spec of node.specifiers) {
          exports.push({
            type: "named",
            name: spec.exported?.name || spec.local?.name,
            local: spec.local?.name,
            line: node.loc?.start?.line || 0,
          });
        }
      }
    }
  }

  return exports;
}

// ─── Main API ──────────────────────────────────────────────────────────────

/**
 * Parsea un archivo JS/TS/JSX y extrae su estructura.
 * @param {string} filePath - Ruta absoluta o relativa al archivo
 * @returns {Promise<object>} - Estructura del archivo
 */
export async function parseFile(filePath) {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return {
      success: false,
      error: `Archivo no encontrado: ${filePath}`,
      path: filePath,
    };
  }

  const stats = fs.statSync(resolvedPath);
  if (!stats.isFile()) {
    return {
      success: false,
      error: `No es un archivo: ${filePath}`,
      path: filePath,
    };
  }

  // Read only first 50KB for performance (covers 99% of files)
  const fd = fs.openSync(resolvedPath, "r");
  const bufferSize = Math.min(stats.size, 50000);
  const buffer = Buffer.alloc(bufferSize);
  fs.readSync(fd, buffer, 0, bufferSize, 0);
  fs.closeSync(fd);

  const source = buffer.toString("utf-8");
  const ext = path.extname(resolvedPath).toLowerCase();

  // Supported extensions
  const supportedExts = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"];
  if (!supportedExts.includes(ext)) {
    return {
      success: false,
      error: `Extensión no soportada: ${ext}. Soportadas: ${supportedExts.join(", ")}`,
      path: filePath,
      extension: ext,
    };
  }

  // Try AST parser first, fallback to regex
  await ensureParser();

  let imports = [];
  let functions = [];
  let exports = [];
  let classes = [];
  let declarations = [];
  let parserUsed = "regex";
  let astParsed = false;

  if (acorn) {
    try {
      const parser = acornLoose || acorn;
      const ecmaVersion = ext === ".mjs" || ext === ".mts" ? 2022 : 2022;
      const sourceType = ext === ".cjs" || ext === ".cts" ? "script" : "module";

      const ast = parser.parse(source, {
        ecmaVersion,
        sourceType,
        locations: true,
        allowImportExportEverywhere: false,
        allowReturnOutsideFunction: false,
      });

      imports = extractImportsAST(ast);
      functions = extractFunctionsAST(ast);
      exports = extractExportsAST(ast);
      parserUsed = "acorn";
      astParsed = true;
    } catch (astErr) {
      // Fallback to regex if AST fails (e.g., JSX without proper parser)
      console.warn(`   ⚠️  AST parse falló para ${path.basename(filePath)}, usando regex: ${astErr.message}`);
    }
  }

  // Fallback: regex extraction (also used for classes + declarations)
  if (!astParsed) {
    imports = extractImportsRegex(source);
    functions = extractFunctionsRegex(source);
    exports = extractExportsRegex(source);
  }

  // Classes and declarations are always regex-based (cheaper)
  classes = extractClassesRegex(source);
  declarations = extractDeclarationsRegex(source);

  return {
    success: true,
    path: filePath,
    fileName: path.basename(filePath),
    extension: ext,
    size: stats.size,
    parserUsed,
    totalLines: source.split("\n").length,
    imports,
    functions,
    exports,
    classes,
    declarations,
  };
}

/**
 * Parsea múltiples archivos en paralelo.
 * @param {string[]} filePaths - Array de rutas
 * @returns {Promise<object[]>}
 */
export async function parseFiles(filePaths) {
  const results = await Promise.allSettled(
    filePaths.map((fp) => parseFile(fp))
  );
  return results.map((r, i) =>
    r.status === "fulfilled" ? r.value : { success: false, error: r.reason?.message, path: filePaths[i] }
  );
}

/**
 * Escanea un directorio y parsea todos los archivos JS/TS.
 * @param {string} dirPath - Ruta al directorio
 * @param {object} options - Opciones
 * @param {boolean} options.recursive - Escanear subdirectorios
 * @param {number} options.maxFiles - Máximo de archivos a parsear
 * @returns {Promise<object[]>}
 */
export async function scanDirectory(dirPath, options = {}) {
  const { recursive = false, maxFiles = 20 } = options;
  const resolvedDir = path.resolve(dirPath);

  if (!fs.existsSync(resolvedDir)) {
    return [{ success: false, error: `Directorio no encontrado: ${dirPath}` }];
  }

  const jsFiles = [];
  const supportedExts = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"];

  function walkDir(currentPath) {
    if (jsFiles.length >= maxFiles) return;

    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (jsFiles.length >= maxFiles) break;
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules, .git, .lv-zero
        if (
          entry.name.startsWith(".") ||
          entry.name === "node_modules"
        ) {
          continue;
        }
        if (recursive) walkDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (supportedExts.includes(ext)) {
          jsFiles.push(fullPath);
        }
      }
    }
  }

  walkDir(resolvedDir);

  // Parse found files
  const results = [];
  for (const fp of jsFiles.slice(0, maxFiles)) {
    results.push(await parseFile(fp));
  }

  return {
    directory: resolvedDir,
    totalFilesFound: jsFiles.length,
    parsed: results.length,
    files: results,
  };
}

/**
 * Skill handler — dispatches tool calls from the orchestrator.
 * @param {object} params - Tool call parameters
 * @param {string} params.action - "parseFile", "parseFiles", or "scanDirectory"
 * @param {string} [params.path] - File path (for parseFile)
 * @param {string[]} [params.paths] - Array of file paths (for parseFiles)
 * @param {string} [params.directory] - Directory path (for scanDirectory)
 * @param {object} [params.options] - Options for scanDirectory { recursive, maxFiles }
 * @returns {Promise<object>}
 */
async function handler(params) {
  const { action } = params || {};
  switch (action) {
    case "parseFile":
      return await parseFile(params.path);
    case "parseFiles":
      return await parseFiles(params.paths || []);
    case "scanDirectory":
      return await scanDirectory(params.directory, params.options || {});
    default:
      return { success: false, error: `Unknown action: ${action}. Expected: parseFile, parseFiles, scanDirectory` };
  }
}

export default {
  name: "code_mapper",
  description: "Parsea archivos JS/TS/JSX usando AST (acorn) + regex para extraer imports, funciones, clases, exports y declaraciones. Ideal para entender la estructura quirúrgica del código sin consumir tokens leyendo archivos completos.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["parseFile", "parseFiles", "scanDirectory"],
        description: "Acción a ejecutar: parseFile (un archivo), parseFiles (varios archivos), scanDirectory (escanea directorio y parsea archivos JS/TS)",
      },
      path: {
        type: "string",
        description: "Ruta del archivo a parsear (requerido para action=parseFile)",
      },
      paths: {
        type: "array",
        items: { type: "string" },
        description: "Array de rutas de archivos a parsear (requerido para action=parseFiles)",
      },
      directory: {
        type: "string",
        description: "Ruta del directorio a escanear (requerido para action=scanDirectory)",
      },
      options: {
        type: "object",
        properties: {
          recursive: { type: "boolean", description: "Escanear subdirectorios" },
          maxFiles: { type: "number", description: "Máximo de archivos a parsear (default: 20)" },
        },
        description: "Opciones adicionales (solo para action=scanDirectory)",
      },
    },
    required: ["action"],
  },
  handler,
  parseFile,
  parseFiles,
  scanDirectory,
};
