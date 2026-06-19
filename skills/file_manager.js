import fs from "fs";
import path from "path";

// ── Import extracted modules ─────────────────────────────────────────────────
import {
  resolveSafePath,
  setProjectRoot,
  getProjectRoot,
  formatSize,
  searchProjectForFile,
  isKnownFile,
} from "./path_resolver.js";

import {
  stripBase64Content,
  truncateLines,
  MAX_FILE_LINES,
} from "./file_security.js";

import {
  detectBinaryType,
  isBinaryFile,
  getBinaryDescription,
  getMimeFromType,
} from "./file_type_detector.js";

import { indexFile } from "./file_indexer.js";

// ═══════════════════════════════════════════════════════════════════════════════
// 🔧 RE-EXPORTS — backward compatibility for tests and dynamic imports
// ═══════════════════════════════════════════════════════════════════════════════
export { resolveSafePath, setProjectRoot, getProjectRoot, formatSize };
export { stripBase64Content, truncateLines, MAX_FILE_LINES };
export { isBinaryFile, detectBinaryType, getBinaryDescription, getMimeFromType };
export { indexFile };

// ═══════════════════════════════════════════════════════════════════════════════
// 📋 KNOWN_FILES — used by handleRead for search-and-suggest
// ═══════════════════════════════════════════════════════════════════════════════

// Re-exported for convenience (already exported from path_resolver via isKnownFile)
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

// ═══════════════════════════════════════════════════════════════════════════════
// 📋 Skill Definition
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * file_manager — Skill de sistema de archivos
 *
 * Permite al agente leer, escribir, listar y eliminar archivos
 * en el disco duro dentro del directorio del proyecto.
 *
 * Refinamiento: si un archivo específico (como flows.json, config.json,
 * package.json, .env) no se encuentra en la ruta indicada, NO asume que
 * no existe. En su lugar, sugiere rutas alternativas y pide al usuario
 * la ubicación exacta antes de dar un error definitivo.
 *
 * 🛡️ Anti-Base64 Shield: Las imágenes incrustadas en archivos JSON/JS/CSS
 * son automaticamente reemplazadas con un placeholder para proteger el contexto.
 * Archivos con más de 1000 líneas se truncan con advertencia.
 */
export default {
  name: "file_manager",
  description:
    "Gestiona archivos en el sistema de archivos del proyecto. " +
    "Puede leer contenido de archivos, escribir/crear archivos, " +
    "listar directorios, y eliminar archivos. Todas las rutas son relativas al proyecto. " +
    "NOTA: Si buscas un archivo conocido (flows.json, config, package.json, .env) " +
    "y no está en la ruta especificada, REPORTE las ubicaciones donde podría estar " +
    "en lugar de fallar inmediatamente.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["read", "write", "list", "delete", "ensure_dir", "find", "append"],
        description:
          "Acción a realizar:\n" +
          '- "read": Lee un chunk de un archivo. REQUIERE "start_line" y "end_line" (máx 150 líneas).\n' +
          '  Usa get_code_outline primero para ver la estructura y decidir qué líneas leer.\n' +
          '- "write": Escribe contenido en un archivo (lo crea si no existe). Requiere "path" y "content".\n' +
          '- "list": Lista los archivos de un directorio. Requiere "path".\n' +
          '- "delete": Elimina un archivo. Requiere "path".\n' +
          '- "ensure_dir": Crea un directorio (y sus padres) si no existe. Requiere "path".\n' +
          '- "find": Busca un archivo por nombre en todo el proyecto. Requiere "path" como nombre de archivo.\n' +
          '- "append": Agrega contenido al final de un archivo existente. Requiere "path" y "content".\n' +
          '  Úsalo para construir archivos grandes por chunks en vez de intentar escribirlos de una sola vez.',
      },
      path: {
        type: "string",
        description:
          "Ruta del archivo o directorio (relativa al proyecto raíz). " +
          'Ejemplo: "src/index.js" o "docs/". Para action="find", usa solo el nombre del archivo.',
      },
      content: {
        type: "string",
        description:
          'Contenido a escribir en el archivo (solo para action="write").',
      },
      recursive: {
        type: "boolean",
        description:
          'Si es true, lista archivos recursivamente (solo para action="list").',
      },
      start_line: {
        type: "number",
        description:
          'Línea de inicio (1-based) para leer un chunk. REQUERIDO para action="read". Máximo 150 líneas de diferencia con end_line.',
      },
      end_line: {
        type: "number",
        description:
          'Línea final (1-based) para leer un chunk. REQUERIDO para action="read". Máximo 150 líneas desde start_line.',
      },
    },
    required: ["action", "path"],
  },

  handler: async ({ action, path: filePath, content, recursive, start_line, end_line }) => {
    // Security: prevent path traversal outside project
    let safePath;
    try {
      safePath = resolveSafePath(filePath);
    } catch (traversalErr) {
      // ── Cross-project permission gate ──
      // If the path is outside the project, ask for user permission.
      // Read is allowed with permission; write requires re-asking.
      const isWrite = action === "write" || action === "delete" || action === "ensure_dir";
      return {
        success: false,
        error: traversalErr.message,
        notFound: filePath,
        suggestions: [],
        requiresUserInput: true,
        message:
          `La ruta "${filePath}" está fuera del directorio actual del proyecto "${path.basename(getProjectRoot())}".\n` +
          (isWrite
            ? `⚠️ **ESCRITURA FUERA DEL PROYECTO**: ¿Permites escribir en "${filePath}" fuera del proyecto? Responde "sí" o "no".`
            : `¿Permites leer el archivo "${filePath}" fuera del proyecto? Responde "sí" o "no".`),
      };
    }

    switch (action) {
      case "read":
        return handleRead(safePath, filePath, { start_line, end_line });

      case "write":
        return handleWrite(safePath, filePath, content);

      case "list":
        return handleList(safePath, filePath, recursive);

      case "delete":
        return handleDelete(safePath, filePath);

      case "ensure_dir":
        return handleEnsureDir(safePath, filePath);

      case "append":
        return handleAppend(safePath, filePath, content);

      case "find":
        return handleFind(filePath);

      default:
        return {
          success: false,
          error: `Acción desconocida: "${action}". Usa: read, write, list, delete, ensure_dir, find.`,
        };
    }
  },
};

// ─── Action Handlers ────────────────────────────────────────────────────────

const MAX_CHUNK_LINES = 150;

function handleRead(safePath, originalPath, options = {}) {
  if (!fs.existsSync(safePath)) {
    // ── Refinement: known file not found → search and suggest ──
    const fileName = path.basename(originalPath);
    if (KNOWN_FILES.includes(fileName)) {
      const found = searchProjectForFile(fileName);
      if (found.length > 0) {
        return {
          success: false,
          error: `"${originalPath}" no encontrado, pero se encontró en otra ubicación.`,
          notFound: originalPath,
          suggestions: found,
          message:
            `El archivo "${fileName}" no está en "${originalPath}" pero existe en:\n` +
            found.map((p) => `  • ${p}`).join("\n") +
            `\n\nPregunta al usuario: ¿en cuál de estas rutas debo leer el archivo?`,
          requiresUserInput: true,
        };
      }

      return {
        success: false,
        error: `"${originalPath}" no encontrado en el proyecto.`,
        notFound: originalPath,
        suggestions: [],
        message:
          `No se encontró "${fileName}" en ninguna ubicación del proyecto. ` +
          `Pregunta al usuario si desea crearlo o si la ruta tiene otro nombre.`,
        requiresUserInput: true,
      };
    }

    // ── Generic file not found ──
    return {
      success: false,
      error: `Archivo no encontrado: "${originalPath}"`,
      notFound: originalPath,
      suggestions: [],
    };
  }

  const stat = fs.statSync(safePath);
  if (stat.isDirectory()) {
    return {
      success: false,
      error: `"${originalPath}" es un directorio, no un archivo. Usa action="list" para listar directorios.`,
    };
  }

  // ── Read file as Buffer (no encoding) for binary detection ────────────────
  const buffer = fs.readFileSync(safePath);

  // 🕵️ Binary detection: check magic bytes + heuristic
  if (isBinaryFile(buffer)) {
    const binType = detectBinaryType(buffer);
    const description = getBinaryDescription(binType);
    return {
      success: true,
      path: originalPath,
      binary: true,
      type: binType,
      description,
      size: formatSize(stat.size),
      mime: getMimeFromType(binType),
      content: `[${description} — ${formatSize(stat.size)}]`,
    };
  }

  // ── Text file — decode as UTF-8 and apply filters ─────────────────────────
  const rawContent = buffer.toString("utf-8");

  // ── Chunk enforcement: require start_line and end_line ──────────────────
  const totalLines = rawContent.split(/\r?\n/).length;
  const hasChunkParams = options.start_line != null || options.end_line != null;

  if (!hasChunkParams) {
    return {
      success: false,
      error: "read_file requiere start_line y end_line para leer archivos. Usa get_code_outline primero para ver la estructura del archivo.",
      path: originalPath,
      totalLines,
      suggestion: `Usa start_line: 1, end_line: ${Math.min(totalLines, MAX_CHUNK_LINES)} para leer el inicio del archivo.`,
      requiresChunkParams: true,
    };
  }

  const start = options.start_line || 1;
  const end = options.end_line || Math.min(start + MAX_CHUNK_LINES - 1, totalLines);
  const chunkSize = end - start + 1;

  if (chunkSize > MAX_CHUNK_LINES) {
    return {
      success: false,
      error: `Chunk demasiado grande: ${chunkSize} líneas (máximo ${MAX_CHUNK_LINES}). Divide la lectura en múltiples llamadas.`,
      path: originalPath,
      totalLines,
      chunkSize,
      maxChunkLines: MAX_CHUNK_LINES,
    };
  }

  if (start < 1 || end > totalLines) {
    return {
      success: false,
      error: `Rango fuera de límites: líneas ${start}-${end}, el archivo tiene ${totalLines} líneas.`,
      path: originalPath,
      totalLines,
    };
  }

  // ── Extract requested chunk ──────────────────────────────────────────
  const lines = rawContent.split(/\r?\n/);
  const chunkLines = lines.slice(start - 1, end);
  const chunkContent = chunkLines.join('\n');

  // 🛡️ Anti-Base64: Strip massive embedded images from chunk
  const { content: filteredContent, replacedCount } = stripBase64Content(chunkContent);
  const base64Filtered = replacedCount > 0;

  // Build result (no line truncation needed — chunk is already limited)
  const warnings = [];
  if (base64Filtered) {
    warnings.push(`⚠️ Se detectaron y reemplazaron ${replacedCount} cadenas Base64 largas.`);
  }

  const result = {
    success: true,
    path: originalPath,
    size: formatSize(stat.size),
    content: filteredContent,
    totalLines,
    lines: { start, end, total: totalLines },
    base64Filtered,
  };

  if (warnings.length > 0) {
    result.warning = warnings.join("\n");
  }

  // 📇 Fire-and-forget: index file metadata in Supabase for change detection
  // (non-blocking — won't delay the response)
  indexFile(originalPath, rawContent, {
    size: stat.size,
    mtime: stat.mtime.toISOString(),
  }).catch(() => {});
  result.indexed = true;

  return result;
}

function handleWrite(safePath, originalPath, content) {
  if (content === undefined || content === null) {
    return {
      success: false,
      error: 'Se requiere "content" para la acción "write".',
    };
  }

  // Ensure parent directory exists
  const dir = path.dirname(safePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(safePath, content, "utf-8");
  const stat = fs.statSync(safePath);

  // 📇 Fire-and-forget: index the newly written file for change detection
  indexFile(originalPath, content, {
    size: stat.size,
    mtime: stat.mtime.toISOString(),
  }).catch(() => {});

  return {
    success: true,
    path: originalPath,
    action: fs.existsSync(safePath) ? (stat.isFile() ? "actualizado" : "creado") : "creado",
    size: formatSize(stat.size),
    indexed: true,
    message: `Archivo "${originalPath}" guardado correctamente.`,
  };
}

function handleList(safePath, originalPath, recursive) {
  if (!fs.existsSync(safePath)) {
    return {
      success: false,
      error: `Directorio no encontrado: "${originalPath}"`,
    };
  }

  const stat = fs.statSync(safePath);
  if (!stat.isDirectory()) {
    return {
      success: false,
      error: `"${originalPath}" es un archivo, no un directorio. Usa action="read" para leer archivos.`,
    };
  }

  const entries = fs.readdirSync(safePath, { withFileTypes: true, recursive: recursive || false });

  const files = entries.map((entry) => {
    const fullPath = path.join(safePath, entry.name);
    let stats = null;
    try {
      stats = fs.statSync(fullPath);
    } catch {
      // symlink or permission issue
    }
    return {
      name: entry.name,
      type: entry.isDirectory() ? "directorio" : "archivo",
      size: stats ? formatSize(stats.size) : null,
    };
  });

  return {
    success: true,
    path: originalPath,
    total: files.length,
    files,
  };
}

function handleDelete(safePath, originalPath) {
  if (!fs.existsSync(safePath)) {
    return {
      success: false,
      error: `Archivo no encontrado: "${originalPath}"`,
    };
  }

  const stat = fs.statSync(safePath);
  if (stat.isDirectory()) {
    fs.rmSync(safePath, { recursive: true });
    return {
      success: true,
      path: originalPath,
      message: `Directorio "${originalPath}" eliminado correctamente.`,
    };
  }

  fs.unlinkSync(safePath);
  return {
    success: true,
    path: originalPath,
    message: `Archivo "${originalPath}" eliminado correctamente.`,
  };
}

function handleEnsureDir(safePath, originalPath) {
  if (fs.existsSync(safePath)) {
    const stat = fs.statSync(safePath);
    if (stat.isDirectory()) {
      return {
        success: true,
        path: originalPath,
        message: `El directorio "${originalPath}" ya existe.`,
      };
    }
    return {
      success: false,
      error: `"${originalPath}" existe pero no es un directorio.`,
    };
  }

  fs.mkdirSync(safePath, { recursive: true });
  return {
    success: true,
    path: originalPath,
    message: `Directorio "${originalPath}" creado correctamente.`,
  };
}

function handleAppend(safePath, originalPath, content) {
  if (content === undefined || content === null) {
    return {
      success: false,
      error: 'Se requiere "content" para la acción "append".',
    };
  }
  const dir = path.dirname(safePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(safePath, content, "utf-8");
  const stat = fs.statSync(safePath);
  return {
    success: true,
    path: originalPath,
    action: "append",
    size: formatSize(stat.size),
    message: `Contenido agregado a "${originalPath}". Tamaño total: ${formatSize(stat.size)}.`,
  };
}

function handleFind(fileName) {
  const found = searchProjectForFile(fileName);
  if (found.length === 0) {
    return {
      success: false,
      error: `No se encontró "${fileName}" en el proyecto.`,
      found: [],
      message:
        `El archivo "${fileName}" no existe en el proyecto. ` +
        `Pregunta al usuario si desea crearlo.`,
      requiresUserInput: true,
    };
  }

  return {
    success: true,
    action: "find",
    query: fileName,
    total: found.length,
    locations: found,
    message: `Se encontró "${fileName}" en ${found.length} ubicación(es).`,
  };
}
