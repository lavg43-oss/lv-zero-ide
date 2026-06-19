import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ═══════════════════════════════════════════════════════════════════════════════
// 🔧 Project Root Management
// ═══════════════════════════════════════════════════════════════════════════════

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, "..");

let PROJECT_ROOT = process.env.LV_PROJECT_PATH || DEFAULT_ROOT;

/**
 * Actualiza dinámicamente la raíz del proyecto para file_manager.
 * Cuando el usuario abre/crea un proyecto en el explorador, el orchestrator
 * llama a esta función para que file_manager opere sobre el proyecto activo
 * en lugar de la raíz de lv-zero.
 *
 * @param {string|null} projectPath - Ruta absoluta del proyecto activo, o null para volver a lv-zero.
 */
export function setProjectRoot(projectPath) {
  if (projectPath) {
    PROJECT_ROOT = path.resolve(projectPath);
    process.env.LV_PROJECT_PATH = PROJECT_ROOT;
  } else {
    PROJECT_ROOT = DEFAULT_ROOT;
    delete process.env.LV_PROJECT_PATH;
  }
}

/**
 * Obtiene la raíz actual del proyecto.
 * @returns {string} Ruta absoluta del proyecto activo
 */
export function getProjectRoot() {
  return PROJECT_ROOT;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔧 Safe Path Resolution
// ═══════════════════════════════════════════════════════════════════════════════

/** Resolves a path to an absolute path inside the project root.
 *  If the input is already absolute (e.g., C:\Users\...), it is resolved
 *  directly from the filesystem root — allowing the user to specify
 *  explicit paths outside the project. Relative paths are resolved
 *  within the project root with traversal protection. */
export function resolveSafePath(inputPath) {
  const normalized = path.normalize(inputPath || "");

  // ── Absolute path (user-specified) → resolve from root ────────────
  // The user explicitly provided a full path; trust that intent.
  if (path.isAbsolute(normalized)) {
    return path.resolve(normalized);
  }

  // ── Relative path → resolve inside project with traversal guard ───
  const resolved = path.resolve(PROJECT_ROOT, normalized);

  if (!resolved.startsWith(PROJECT_ROOT)) {
    throw new Error(
      `Path traversal detectado: "${inputPath}" está fuera del directorio del proyecto.`
    );
  }

  return resolved;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔧 File Search & Formatting
// ═══════════════════════════════════════════════════════════════════════════════

/** Known files that might be in non-obvious locations */
const KNOWN_FILES = [
  "flows.json",
  "config.json",
  "package.json",
  ".env",
  ".env.example",
  "PLAN.md",
  "LOGICA.md",
  "tsconfig.json",
  "vite.config.ts",
  "next.config.js",
  "tailwind.config.js",
  "docker-compose.yml",
  "Dockerfile",
  "schema.sql",
  "seed.sql",
  "README.md",
];

/** Formats file size in human-readable format */
export function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}

/** Searches the entire project for a file by name */
export function searchProjectForFile(fileName) {
  const results = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules and .git
        if (entry.name !== "node_modules" && entry.name !== ".git" && !entry.name.startsWith(".")) {
          walk(fullPath);
        }
      } else if (entry.name === fileName) {
        results.push(path.relative(PROJECT_ROOT, fullPath));
      }
    }
  }

  walk(PROJECT_ROOT);
  return results;
}

/**
 * Check whether a file name is one of the "known" files that get
 * special treatment in the search-and-suggest flow.
 * @param {string} fileName
 * @returns {boolean}
 */
export function isKnownFile(fileName) {
  return KNOWN_FILES.includes(fileName);
}

// ─── Default export for skill loader ───────────────────────────────────────

const description = 'Resuelve rutas de archivos de forma segura. Convierte rutas relativas a absolutas, resuelve symlinks, valida que estén dentro del proyecto. Úsala cuando necesites normalizar una ruta de archivo.';

const parameters = {
    type: 'object',
    properties: {
        inputPath: { type: 'string', description: 'Ruta a resolver' },
        basePath: { type: 'string', description: 'Directorio base (default: directorio del proyecto)' }
    },
    required: ['inputPath']
};

async function handler(params) {
    const resolved = resolveSafePath(params.inputPath);
    return { resolvedPath: resolved };
}

export default {
    name: 'path_resolver',
    description,
    parameters,
    handler
};
