/**
 * repo_mapper.js — Indexador Semántico (Repo Mapper)
 *
 * Escanea recursivamente un directorio, respeta .gitignore,
 * ignora node_modules, y extrae la estructura semántica
 * (funciones, clases, imports/exports) de cada archivo de código.
 *
 * Inspirado en el sistema de mapas de Aider.
 * v1.0.0
 */

import fs from "fs";
import path from "path";
import ignore from "ignore";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ─── Extensiones de código a analizar ───────────────────────────────────────

const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx",      // JavaScript/TypeScript
  ".html", ".htm", ".css", ".scss",   // Web
  ".json", ".xml", ".yaml", ".yml",   // Data
  ".md",                               // Docs
  ".py",                               // Python
  ".java", ".kt", ".kts",             // JVM
  ".go",                                // Go
  ".rs",                                // Rust
  ".rb",                                // Ruby
  ".php",                               // PHP
  ".swift",                             // Swift
  ".c", ".cpp", ".h", ".hpp",          // C/C++
  ".vue", ".svelte",                    // Frameworks
]);

// ─── Export ──────────────────────────────────────────────────────────────────

export default {
  name: "repo_mapper",
  description:
    "Indexador Semántico (Repo Mapper). Escanea recursivamente un directorio " +
    "ignorando .gitignore y node_modules. Extrae funciones, clases, imports/exports " +
    "de cada archivo de código y devuelve un 'mapa mental' en texto plano. " +
    "Inspirado en el sistema de mapas de Aider.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["map"],
        description:
          "Acción a realizar:\n" +
          '- "map": Escanea el directorio y genera el mapa semántico.',
      },
      directory: {
        type: "string",
        description:
          "Ruta del directorio a escanear (relativa al proyecto raíz). " +
          'Ejemplo: "src" o "src/core". Por defecto: raíz del proyecto.',
      },
      includeExtensions: {
        type: "string",
        description:
          "Extensiones adicionales a incluir, separadas por coma. " +
          'Ejemplo: ".graphql,.proto"',
      },
      maxDepth: {
        type: "number",
        description:
          "Profundidad máxima de escaneo. Por defecto: 20 (ilimitado práctico).",
        default: 20,
      },
    },
    required: ["action"],
  },

  handler: async ({ action, directory, includeExtensions, maxDepth }) => {
    if (action !== "map") {
      return {
        success: false,
        error: `Acción desconocida: "${action}". Usa: map.`,
      };
    }

    const rootDir = directory
      ? path.resolve(PROJECT_ROOT, directory)
      : PROJECT_ROOT;

    // Validar que el directorio existe
    if (!fs.existsSync(rootDir)) {
      return {
        success: false,
        error: `Directorio no encontrado: "${directory}"`,
      };
    }

    // Agregar extensiones adicionales si se especificaron
    const extensions = new Set(CODE_EXTENSIONS);
    if (includeExtensions) {
      for (const ext of includeExtensions.split(",")) {
        const trimmed = ext.trim();
        if (trimmed) {
          extensions.add(trimmed.startsWith(".") ? trimmed : `.${trimmed}`);
        }
      }
    }

    try {
      const result = await buildMap(rootDir, extensions, maxDepth || 20);
      return {
        success: true,
        directory: directory || ".",
        rootDir: rootDir,
        totalFiles: result.totalFiles,
        totalDirs: result.totalDirs,
        map: result.map,
        stats: result.stats,
        truncated: result.truncated,
        truncatedCount: result.truncatedCount,
      };
    } catch (err) {
      return {
        success: false,
        error: `Error al escanear: ${err.message}`,
      };
    }
  },
};

// ─── Core Logic ──────────────────────────────────────────────────────────────

/**
 * Construye el mapa semántico del directorio.
 */
async function buildMap(rootDir, extensions, maxDepth) {
  // Cargar .gitignore si existe
  const ig = ignore();
  ig.add("node_modules"); // Siempre ignorar node_modules

  const gitignorePath = path.join(rootDir, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, "utf-8");
    ig.add(gitignoreContent);
  }

  const lines = [];
  const stats = {
    scanned: 0,
    ignored: 0,
    parsed: 0,
    errors: 0,
  };

  let truncated = false;
  let truncatedCount = 0;
  const MAX_LINES = 500; // Límite de líneas del mapa para no saturar el contexto

  /**
   * Recursión de escaneo.
   */
  function walk(dir, depth) {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      stats.errors++;
      return;
    }

    // Ordenar: directorios primero, luego archivos
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (truncated) return;

      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(rootDir, fullPath);
      const relPathPosix = relPath.replace(/\\/g, "/");

      // Ignorar según .gitignore
      if (ig.ignores(relPathPosix)) {
        stats.ignored++;
        continue;
      }

      // Ignorar carpetas ocultas (no .gitignore en sí, pero buena práctica)
      if (entry.isDirectory() && entry.name.startsWith(".") && entry.name !== ".") {
        stats.ignored++;
        continue;
      }

      if (entry.isDirectory()) {
        stats.totalDirs = (stats.totalDirs || 0) + 1;
        if (lines.length < MAX_LINES) {
          lines.push(`📁 ${relPath}/`);
        }
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        stats.scanned++;
        const ext = path.extname(entry.name).toLowerCase();

        if (extensions.has(ext)) {
          stats.parsed++;
          const fileMap = parseFileStructure(fullPath, relPath);

          if (lines.length < MAX_LINES) {
            if (fileMap.structures.length > 0) {
              lines.push(`📄 ${relPath}`);
              for (const struct of fileMap.structures) {
                lines.push(`   ${struct}`);
              }
            } else {
              lines.push(`📄 ${relPath}  —  (${fileMap.size})`);
            }

            // Si el archivo tiene imports/exports relevantes, mostrarlos
            if (fileMap.imports.length > 0 && lines.length < MAX_LINES) {
              const importSummary = summarizeImports(fileMap.imports);
              if (importSummary) {
                lines.push(`   📥 ${importSummary}`);
              }
            }
          } else {
            truncatedCount++;
          }
        } else {
          stats.ignored++;
        }
      }
    }
  }

  walk(rootDir, 0);

  if (truncatedCount > 0) {
    truncated = true;
  }

  // Compilar el mapa
  let map;
  if (lines.length === 0) {
    map = `(vacío — no se encontraron archivos de código en ${path.relative(PROJECT_ROOT, rootDir) || "."})`;
  } else {
    map = lines.join("\n");
  }

  return {
    map,
    totalFiles: stats.scanned,
    totalDirs: stats.totalDirs || 0,
    stats,
    truncated,
    truncatedCount,
  };
}

/**
 * Extrae la estructura semántica de un archivo de código.
 * Usa expresiones regulares para encontrar funciones, clases, etc.
 */
function parseFileStructure(filePath, relPath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return { structures: [], imports: [], exports: [], size: "?" };
  }

  const ext = path.extname(filePath).toLowerCase();
  const size = formatSize(fs.statSync(filePath).size);
  const lines = content.split("\n");
  const structures = [];
  const imports = [];
  const exports = [];

  if (ext === ".json") {
    // Para JSON, solo indicar si es objeto/array
    const trimmed = content.trim();
    if (trimmed.startsWith("[")) {
      structures.push(`🔷 Array (${lines.length} lines)`);
    } else if (trimmed.startsWith("{")) {
      // Extraer keys del root
      const keys = extractJSONKeys(content);
      if (keys.length > 0) {
        structures.push(`🔷 Object keys: ${keys.join(", ")}`);
      } else {
        structures.push(`🔷 Object (${lines.length} lines)`);
      }
    }
    return { structures, imports, exports, size };
  }

  if (ext === ".md" || ext === ".html" || ext === ".htm") {
    // Para markdown/html, contar secciones/headers
    const headers = [];
    for (const line of lines) {
      const hMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (hMatch) {
        headers.push(`${hMatch[1].length}.${hMatch[2].trim()}`);
      }
    }
    if (headers.length > 0) {
      structures.push(`📑 Sections: ${headers.length}`);
      for (const h of headers.slice(0, 10)) {
        structures.push(`   → H${h}`);
      }
      if (headers.length > 10) {
        structures.push(`   ... y ${headers.length - 10} más`);
      }
    } else {
      structures.push(`📄 ${lines.length} lines`);
    }
    return { structures, imports, exports, size };
  }

  // ─── Para archivos de código (JS, TS, Python, etc.) ───

  // Clases
  const classPatterns = [
    /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,             // class Name
    /^(?:export\s+)?(?:default\s+)?class\s+(\w+)/,               // export default class
    /^(?:export\s+)?interface\s+(\w+)/,                           // interface Name
    /^(?:export\s+)?type\s+(\w+)\s*=/,                            // type Name =
    /^(?:export\s+)?enum\s+(\w+)/,                                // enum Name
  ];

  // Funciones
  const funcPatterns = [
    /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,               // function name
    /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/,         // function* name
    /^(?:export\s+)?(?:async\s+)?\(?\w+\)?\s*=>\s*{/,            // arrow function (top level)
    /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/,  // const name = (
    /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?function/, // const name = function
    /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?=>/,     // const name = =>
  ];

  // Métodos dentro de clases (indentados)
  const methodPattern = /^\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*{/;

  // Imports (JavaScript/TypeScript)
  const importPatterns = [
    /^import\s+(?:\{[^}]*\}\s+from\s+)?['"]([^'"]+)['"]/,       // import ... from 'x'
    /^import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/,                 // import X from 'y'
    /^import\s+['"]([^'"]+)['"]/,                                 // import 'x'
    /^const\s+\w+\s*=\s*require\(['"]([^'"]+)['"]\)/,            // require
  ];

  // Exports
  const exportPatterns = [
    /^export\s+default\s+(\w+)/,
    /^export\s+\{[^}]*\}/,
    /^module\.exports\s*=/,
  ];

  let inMultilineComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Saltar comentarios
    if (trimmed.startsWith("//")) continue;
    if (trimmed.startsWith("/*") || trimmed.startsWith("/**")) {
      if (!trimmed.includes("*/")) inMultilineComment = true;
      continue;
    }
    if (inMultilineComment) {
      if (trimmed.includes("*/")) inMultilineComment = false;
      continue;
    }
    if (trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    // Detectar imports
    for (const pattern of importPatterns) {
      const match = trimmed.match(pattern);
      if (match) {
        imports.push(match[1] || match[2] || match[0]);
        break;
      }
    }

    // Detectar exports
    for (const pattern of exportPatterns) {
      const match = trimmed.match(pattern);
      if (match) {
        exports.push(match[1] || match[0]);
        break;
      }
    }

    // Detectar clases
    for (const pattern of classPatterns) {
      const match = trimmed.match(pattern);
      if (match) {
        const name = match[1];
        // Determinar tipo exacto
        let type = "class";
        if (trimmed.includes("interface")) type = "interface";
        else if (trimmed.includes("type ")) type = "type";
        else if (trimmed.includes("enum")) type = "enum";
        structures.push(`🔷 ${type} ${name}`);
        break;
      }
    }

    // Detectar funciones (solo si no estamos dentro de una clase ya detectada)
    const isIndented = line.startsWith("  ") || line.startsWith("\t");
    if (isIndented) {
      const m = trimmed.match(methodPattern);
      if (m) {
        structures.push(`   🔸 method ${m[1]}`);
      }
    } else {
      for (const pattern of funcPatterns) {
        const match = trimmed.match(pattern);
        if (match) {
          const name = match[1] || "(anonymous arrow)";
          structures.push(`🔸 function ${name}`);
          break;
        }
      }
    }
  }

  return { structures, imports, exports, size };
}

/**
 * Extrae keys de un JSON raíz.
 */
function extractJSONKeys(content) {
  try {
    const obj = JSON.parse(content);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      return Object.keys(obj).slice(0, 20);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Resumen compacto de imports.
 */
function summarizeImports(imports) {
  if (imports.length === 0) return "";
  const local = imports.filter((i) => i.startsWith(".") || i.startsWith("/"));
  const external = imports.filter((i) => !i.startsWith(".") && !i.startsWith("/"));
  const parts = [];
  if (local.length > 0) parts.push(`${local.length} local`);
  if (external.length > 0) parts.push(`${external.length} external`);
  return `${imports.length} imports (${parts.join(", ")})`;
}

/**
 * Formatea tamaño de archivo.
 */
function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}
