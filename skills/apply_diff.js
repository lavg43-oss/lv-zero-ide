/**
 * lv-zero — ApplyDiff (Edición por Parches)
 *
 * v1.0
 *   Skill que implementa edición quirúrgica SEARCH/REPLACE sobre archivos.
 *   Lee el archivo, localiza el bloque SEARCH (con soporte de línea de inicio),
 *   lo reemplaza por el bloque REPLACE, y escribe el resultado.
 *   Reporta diff lines añadidas/eliminadas.
 *
 * Uso desde el LLM (tool call):
 *   action: "patch"
 *   path: "ruta/al/archivo.js"
 *   search: "código exacto a buscar"
 *   replace: "código nuevo"
 *   start_line: (opcional) número de línea para validación/anclaje
 */

import fs from "fs";
import path from "path";

// ─── Core Patch Engine ──────────────────────────────────────────────────────

/**
 * Aplica un parche SEARCH/REPLACE a un archivo.
 * @param {string} filePath - Ruta absoluta o relativa al archivo
 * @param {string} searchContent - Contenido exacto a buscar
 * @param {string} replaceContent - Contenido nuevo con el que reemplazar
 * @param {object} [options]
 * @param {number} [options.startLine] - Línea (1-based) donde debería comenzar el bloque search (para validación)
 * @returns {object} { success, path, insertedLines, deletedLines, message, error? }
 */
function applyPatch(filePath, searchContent, replaceContent, options = {}) {
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

  const originalContent = fs.readFileSync(resolvedPath, "utf-8");
  const originalLines = originalContent.split("\n");

  // ── Strict match first ──
  let idx = originalContent.indexOf(searchContent);

  // ── Fallback: normalize whitespace and try again ──
  if (idx === -1) {
    // Normalize: collapse multiple spaces, trim trailing whitespace per line
    const normalizedOriginal = originalLines
      .map((l) => l.replace(/[ \t]+$/g, ""))
      .join("\n");
    const normalizedSearch = searchContent
      .split("\n")
      .map((l) => l.replace(/[ \t]+$/g, ""))
      .join("\n");
    idx = normalizedOriginal.indexOf(normalizedSearch);

    if (idx !== -1) {
      // Found via normalized matching — extract the actual content from the original file
      const searchLines = normalizedSearch.split("\n");
      const searchLineCount = searchLines.length;
      const beforeSearch = normalizedOriginal.substring(0, idx);
      const matchStartLine = beforeSearch.split("\n").length; // 1-based

      if (options.startLine && options.startLine !== matchStartLine) {
        return {
          success: false,
          error: `SEARCH block encontrado pero en línea ${matchStartLine}, se esperaba línea ${options.startLine}. Usa --force para ignorar.`,
          path: filePath,
          matchLine: matchStartLine,
          expectedLine: options.startLine,
        };
      }

      // 🔥 FIX: Extract the actual matching content from the ORIGINAL file (not normalized).
      // The original searchContent has whitespace differences (trailing spaces, etc.) that
      // would cause String.replace() to fail. By extracting the actual lines from the
      // original file at the matched position, we guarantee a correct replacement.
      const actualSearchInOriginal = originalLines
        .slice(matchStartLine - 1, matchStartLine - 1 + searchLineCount)
        .join("\n");

      return executeReplace(originalContent, actualSearchInOriginal, replaceContent, resolvedPath);
    }

    // ── Attempt similarity matching via line-by-line comparison ──
    const searchLines = searchContent.split("\n");
    const searchLen = searchLines.length;
    let bestMatch = { score: 0, line: 0 };

    for (let i = 0; i <= originalLines.length - searchLen; i++) {
      let matches = 0;
      for (let j = 0; j < searchLen; j++) {
        const oLine = originalLines[i + j].trim();
        const sLine = searchLines[j].trim();
        if (oLine === sLine) matches++;
      }
      const score = matches / searchLen;
      if (score > bestMatch.score) {
        bestMatch = { score, line: i + 1 };
      }
    }

    if (bestMatch.score >= 0.6) {
      // We found a partial match — report with similarity score
      return {
        success: false,
        error: `SEARCH block no coincide exactamente. Mejor coincidencia en línea ${bestMatch.line} con ${Math.round(bestMatch.score * 100)}% similitud. Revisa espacios/indentación.`,
        path: filePath,
        similarityPct: Math.round(bestMatch.score * 100),
        matchLine: bestMatch.line,
      };
    }

    return {
      success: false,
      error: `SEARCH block no encontrado en el archivo. Verifica que el contenido a buscar exista exactamente (incluyendo indentación y espacios).`,
      path: filePath,
      searchLength: searchContent.length,
      fileLength: originalContent.length,
    };
  }

  // Strict match succeeded — validate start line if provided
  if (options.startLine) {
    const beforeSearch = originalContent.substring(0, idx);
    const actualLine = beforeSearch.split("\n").length;
    if (actualLine !== options.startLine) {
      return {
        success: false,
        error: `SEARCH block encontrado pero en línea ${actualLine}, se esperaba línea ${options.startLine}.`,
        path: filePath,
        matchLine: actualLine,
        expectedLine: options.startLine,
      };
    }
  }

  return executeReplace(originalContent, searchContent, replaceContent, resolvedPath);
}

/**
 * Executes the actual replacement and writes the file.
 */
function executeReplace(originalContent, searchContent, replaceContent, resolvedPath) {
  const searchLines = searchContent.split("\n");
  const replaceLines = replaceContent.split("\n");

  const newContent = originalContent.replace(searchContent, replaceContent);

  if (newContent === originalContent) {
    return {
      success: false,
      error: "La operación de reemplazo no modificó el archivo (search == replace?).",
      path: resolvedPath,
    };
  }

  // Write the file
  try {
    fs.writeFileSync(resolvedPath, newContent, "utf-8");
  } catch (err) {
    return {
      success: false,
      error: `Error al escribir el archivo: ${err.message}`,
      path: resolvedPath,
    };
  }

  const deletedLines = searchLines.length;
  const insertedLines = replaceLines.length;

  return {
    success: true,
    path: resolvedPath,
    deletedLines,
    insertedLines,
    netChange: insertedLines - deletedLines,
    message: `Parche aplicado: -${deletedLines} +${insertedLines} líneas (neto: ${insertedLines - deletedLines})`,
  };
}

// ─── Skill Handler ──────────────────────────────────────────────────────────

/**
 * Skill handler — dispatches tool calls from the orchestrator.
 * @param {object} params
 * @param {string} params.action - "patch" (required)
 * @param {string} params.path - Ruta del archivo a modificar
 * @param {string} params.search - Contenido exacto a buscar (SEARCH block)
 * @param {string} params.replace - Contenido nuevo (REPLACE block)
 * @param {number} [params.start_line] - Línea opcional de anclaje
 * @returns {object}
 */
async function handler(params) {
  const { action, path: filePath, search, replace, start_line } = params || {};

  if (action !== "patch") {
    return { success: false, error: `Unknown action: ${action}. Expected: "patch"` };
  }

  if (!filePath) {
    return { success: false, error: "Se requiere 'path' (ruta del archivo a modificar)" };
  }

  if (!search) {
    return { success: false, error: "Se requiere 'search' (contenido exacto a buscar)" };
  }

  if (replace === undefined || replace === null) {
    return { success: false, error: "Se requiere 'replace' (contenido nuevo)" };
  }

  return applyPatch(filePath, search, replace, { startLine: start_line });
}

export default {
  name: "apply_diff",
  description: "Aplica ediciones quirúrgicas a archivos usando el formato SEARCH/REPLACE. Localiza un bloque de código exacto (search) dentro de un archivo y lo reemplaza por otro (replace). Ideal para modificaciones precisas sin tener que re-escribir archivos completos.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["patch"],
        description: "Acción a ejecutar. Siempre 'patch'.",
      },
      path: {
        type: "string",
        description: "Ruta del archivo a modificar (relativa o absoluta).",
      },
      search: {
        type: "string",
        description: "Contenido EXACTO a buscar dentro del archivo (SEARCH block). Debe coincidir incluyendo indentación y espacios.",
      },
      replace: {
        type: "string",
        description: "Contenido nuevo con el que reemplazar (REPLACE block).",
      },
      start_line: {
        type: "number",
        description: "Número de línea (1-based) opcional donde debería comenzar el SEARCH block. Ayuda a validar que se está editando el bloque correcto.",
      },
    },
    required: ["action", "path", "search", "replace"],
  },
  handler,
};
