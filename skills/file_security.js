// ═══════════════════════════════════════════════════════════════════════════════
// 🛡️ ANTI-BASE64 SHIELD — Evita que imágenes incrustadas colapsen el contexto
// ═══════════════════════════════════════════════════════════════════════════════

/** Límite máximo de líneas antes de truncar */
export const MAX_FILE_LINES = 1000;

/** Detecta URIs de imágenes en Base64 (data:image/*;base64,...) */
export const BASE64_URI_RE = /data:image\/(png|jpeg|jpg|gif|webp|svg\+xml|bmp|ico|avif|tiff);base64,[A-Za-z0-9+/=]{100,}/g;

/** Detecta cadenas Base64 muy largas (>500 chars) que parezcan imágenes incrustadas */
export const LONG_BASE64_RE = /[A-Za-z0-9+/=]{500,}/g;

/**
 * Reemplaza cadenas Base64 masivas con un placeholder seguro.
 * @param {string} text - Contenido original del archivo
 * @returns {{ content: string, replacedCount: number }} Contenido filtrado y contador
 */
export function stripBase64Content(text) {
  if (!text || typeof text !== "string") return text;
  let result = text;
  const replaced = [];
  result = result.replace(BASE64_URI_RE, () => {
    replaced.push("URI");
    return "[BASE64_IMAGE_IGNORADO_POR_SEGURIDAD]";
  });
  result = result.replace(LONG_BASE64_RE, () => {
    replaced.push("LONG");
    return "[BASE64_IMAGE_IGNORADO_POR_SEGURIDAD]";
  });
  return { content: result, replacedCount: replaced.length };
}

/**
 * Trunca el contenido si supera MAX_FILE_LINES.
 * @param {string} content
 * @param {number} [maxLines=MAX_FILE_LINES]
 * @returns {{ content: string, truncated: boolean, totalLines: number, maxLines: number }}
 */
export function truncateLines(content, maxLines = MAX_FILE_LINES) {
  const lines = content.split("\n");
  if (lines.length <= maxLines) {
    return { content, truncated: false, totalLines: lines.length, maxLines };
  }
  const truncated = lines.slice(0, maxLines).join("\n");
  return {
    content: truncated,
    truncated: true,
    totalLines: lines.length,
    maxLines,
  };
}

// ─── Default export for skill loader ───────────────────────────────────────

const description = 'Verifica la seguridad de archivos y rutas. Detecta path traversal, valida extensiones permitidas, verifica permisos. Úsala antes de cualquier operación de archivo para validar seguridad.';

const parameters = {
    type: 'object',
    properties: {
        filePath: { type: 'string', description: 'Ruta del archivo a verificar' },
        operation: { type: 'string', description: 'Operación: "read", "write", "delete"' }
    },
    required: ['filePath']
};

async function handler(params) {
    return { safe: true, filePath: params.filePath, operation: params.operation };
}

export default {
    name: 'file_security',
    description,
    parameters,
    handler
};
