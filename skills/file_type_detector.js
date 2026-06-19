/**
 * 🕵️ Smart Binary Detection for lv-zero
 *
 * Detects binary file types using magic bytes (file signatures) with a
 * printable-ASCII heuristic fallback. This prevents binary content from
 * polluting the LLM context and avoids garbled UTF-8 decoding errors.
 *
 * Usage:
 *   import { detectBinaryType, isBinaryFile } from "./file_type_detector.js";
 *
 *   const buffer = fs.readFileSync("image.png");
 *   const type = detectBinaryType(buffer);   // "PNG"
 *   const bin   = isBinaryFile(buffer);      // true
 */

// ═══════════════════════════════════════════════════════════════════════════════
// MAGIC BYTE SIGNATURES
// ═══════════════════════════════════════════════════════════════════════════════

const MAGIC_BYTES = {
  PNG:  [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  JPEG: [0xFF, 0xD8, 0xFF],
  GIF:  [0x47, 0x49, 0x46, 0x38],            // GIF87a or GIF89a
  BMP:  [0x42, 0x4D],                         // "BM"
  ICO:  [0x00, 0x00, 0x01, 0x00],            // .ico

  PDF:  [0x25, 0x50, 0x44, 0x46],            // "%PDF"
  ZIP:  [0x50, 0x4B, 0x03, 0x04],            // PKZIP
  _7Z:  [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C], // 7z
  GZIP: [0x1F, 0x8B, 0x08],                  // .gz
  RAR:  [0x52, 0x61, 0x72, 0x21],            // "Rar!"
  BZ2:  [0x42, 0x5A, 0x68],                  // "BZh"

  ELF:  [0x7F, 0x45, 0x4C, 0x46],            // 0x7F + "ELF"
  MACHO: [0xFE, 0xED, 0xFA, 0xCE],           // Mach-O (32-bit big)
  MACHO64: [0xFE, 0xED, 0xFA, 0xCF],         // Mach-O (64-bit big)
  PE:   [0x4D, 0x5A],                         // "MZ" (DOS header → PE)

  WASM: [0x00, 0x61, 0x73, 0x6D],            // "\0asm"
  OGG:  [0x4F, 0x67, 0x67, 0x53],            // "OggS"
  MP3:  [0x49, 0x44, 0x33],                  // ID3 tag
  FLAC: [0x66, 0x4C, 0x61, 0x43],            // "fLaC"
  RIFF: [0x52, 0x49, 0x46, 0x46],            // "RIFF" (AVI / WAV — WEBP handled via MAGIC_OFFSETS)
  TTF:  [0x00, 0x01, 0x00, 0x00, 0x00],      // TrueType
  OTF:  [0x4F, 0x54, 0x54, 0x4F],            // "OTTO" (OpenType)
  WOFF: [0x77, 0x4F, 0x46, 0x46],            // "wOFF"
  WOFF2: [0x77, 0x4F, 0x46, 0x32],           // "wOF2"

  SQLITE: [0x53, 0x51, 0x4C, 0x69, 0x74, 0x65], // "SQLite"
  DJVU: [0x41, 0x54, 0x26, 0x54, 0x46],      // "AT&T" (DJVU)
  TORRENT: [0x64, 0x38, 0x3A, 0x61, 0x6E, 0x6E, 0x6F, 0x75, 0x6E, 0x63, 0x65], // "d8:announce"
};

// Special detection for formats that need offset-based checks
// NOTE: WEBP is checked BEFORE general RIFF to disambiguate (both start with "RIFF").
// WEBP has "WEBP" at offset 8; WAV has "WAVE", AVI has "AVI ".
const MAGIC_OFFSETS = {
  WEBP: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },  // "WEBP" at byte 8
  TAR:  { offset: 257, bytes: [0x75, 0x73, 0x74, 0x61, 0x72] }, // "ustar" at offset 257
};

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect binary file type from a Buffer by checking magic bytes.
 *
 * @param {Buffer} buffer - Raw file contents (at least ~260 bytes recommended)
 * @returns {string|null} - Type name (e.g. "PNG", "PDF", "ZIP") or null if unknown
 */
export function detectBinaryType(buffer) {
  if (!buffer || buffer.length === 0) return null;

  // 1. Check direct magic bytes
  let riffMatch = false;
  for (const [type, magic] of Object.entries(MAGIC_BYTES)) {
    if (buffer.length < magic.length) continue;
    if (magic.every((byte, i) => buffer[i] === byte)) {
      // 🎯 RIFF family (WEBP/WAV/AVI) needs disambiguation at offset 8
      if (type === "RIFF") {
        riffMatch = true;
        break; // found RIFF header; now check offset-based subtypes
      }
      return type;
    }
  }

  // 2. Check offset-based magic bytes (WEBP at offset 8, TAR at offset 257)
  for (const [type, { offset, bytes }] of Object.entries(MAGIC_OFFSETS)) {
    const end = offset + bytes.length;
    if (buffer.length < end) continue;
    if (bytes.every((byte, i) => buffer[offset + i] === byte)) {
      return type;
    }
  }

  // 3. If we found "RIFF" but no offset-based subtype matched, return generic RIFF
  if (riffMatch) return "RIFF";

  return null;
}

/**
 * Determine whether a Buffer contains binary (non-text) data.
 *
 * Uses magic byte detection first. If inconclusive, falls back to a
 * printable-ASCII heuristic: if >30% of bytes are non-printable,
 * the content is considered binary.
 *
 * @param {Buffer} buffer - Raw file contents
 * @returns {boolean} - true if binary, false if text
 */
export function isBinaryFile(buffer) {
  if (!buffer || buffer.length === 0) return false;

  // 1. Magic byte check (fast path)
  const detected = detectBinaryType(buffer);
  if (detected) return true;

  // 2. Null byte in first 512 bytes → almost certainly binary
  const checkLen = Math.min(buffer.length, 512);
  for (let i = 0; i < checkLen; i++) {
    if (buffer[i] === 0x00) return true;
  }

  // 3. Printable-ASCII heuristic over the full buffer (sampled)
  const sampleLen = Math.min(buffer.length, 4096);
  let nonPrintable = 0;
  const threshold = sampleLen * 0.30; // 30%

  for (let i = 0; i < sampleLen; i++) {
    const byte = buffer[i];
    // Allow: tab (0x09), LF (0x0A), CR (0x0D), and printable ASCII (0x20–0x7E)
    const isPrintable =
      byte === 0x09 ||
      byte === 0x0A ||
      byte === 0x0D ||
      (byte >= 0x20 && byte <= 0x7E);
    if (!isPrintable) {
      nonPrintable++;
      if (nonPrintable > threshold) return true; // early exit
    }
  }

  return false;
}

/**
 * Get a human-readable description for common binary types.
 *
 * @param {string} type - Type name from detectBinaryType()
 * @returns {string} - Human description
 */
export function getBinaryDescription(type) {
  const descriptions = {
    PNG:    "Imagen PNG",
    JPEG:   "Imagen JPEG",
    GIF:    "Imagen GIF",
    BMP:    "Imagen BMP",
    WEBP:   "Imagen WebP",
    ICO:    "Icono",
    PDF:    "Documento PDF",
    ZIP:    "Archivo ZIP",
    _7Z:    "Archivo 7z",
    GZIP:   "Archivo GZip",
    RAR:    "Archivo RAR",
    TAR:    "Archivo TAR",
    BZ2:    "Archivo BZip2",
    ELF:    "Binario ELF",
    MACHO:  "Binario Mach-O (32-bit)",
    MACHO64:"Binario Mach-O (64-bit)",
    PE:     "Ejecutable PE (Windows)",
    WASM:   "WebAssembly",
    OGG:    "Audio Ogg",
    MP3:    "Audio MP3",
    FLAC:   "Audio FLAC",
    RIFF:   "Multimedia RIFF (AVI/WAV)",
    TTF:    "Fuente TrueType",
    OTF:    "Fuente OpenType",
    WOFF:   "Fuente Web (WOFF)",
    WOFF2:  "Fuente Web (WOFF2)",
    SQLITE: "Base de datos SQLite",
    DJVU:   "Documento DjVu",
    TORRENT:"Archivo Torrent",
  };
  return descriptions[type] || `Binario desconocido (${type})`;
}

/**
 * Get a standard MIME type string for common binary types.
 *
 * @param {string} type - Type name from detectBinaryType()
 * @returns {string} - MIME type string, or "application/octet-stream" if unknown
 */
export function getMimeFromType(type) {
  const mimeMap = {
    PNG:    "image/png",
    JPEG:   "image/jpeg",
    GIF:    "image/gif",
    BMP:    "image/bmp",
    WEBP:   "image/webp",
    ICO:    "image/x-icon",
    PDF:    "application/pdf",
    ZIP:    "application/zip",
    _7Z:    "application/x-7z-compressed",
    GZIP:   "application/gzip",
    RAR:    "application/vnd.rar",
    TAR:    "application/x-tar",
    BZ2:    "application/x-bzip2",
    ELF:    "application/x-elf",
    MACHO:  "application/x-mach-binary",
    MACHO64:"application/x-mach-binary",
    PE:     "application/x-msdownload",
    WASM:   "application/wasm",
    OGG:    "audio/ogg",
    MP3:    "audio/mpeg",
    FLAC:   "audio/flac",
    RIFF:   "audio/x-wav",
    TTF:    "font/ttf",
    OTF:    "font/otf",
    WOFF:   "font/woff",
    WOFF2:  "font/woff2",
    SQLITE: "application/vnd.sqlite3",
    DJVU:   "image/vnd.djvu",
    TORRENT:"application/x-bittorrent",
  };
  return mimeMap[type] || "application/octet-stream";
}

const description = 'Detecta el tipo de archivo basado en su contenido y extensión. Identifica binarios, texto, imágenes, código fuente, etc. Úsala cuando el usuario suba archivos o pregunte sobre tipos de archivo.';

const parameters = {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['detect', 'is_binary', 'describe', 'mime'],
            description: 'Acción a ejecutar'
        },
        buffer: {
            type: 'array',
            items: { type: 'integer' },
            description: 'Buffer con contenido del archivo (array de bytes)'
        },
        typeName: { type: 'string', description: 'Nombre del tipo (para describe/mime)' }
    },
    required: ['action']
};

async function handler(args) {
    const { action, buffer, typeName } = args || {};
    // Convert buffer array back to Buffer if provided
    const buf = buffer ? Buffer.from(buffer) : null;
    switch (action) {
        case 'detect':
            return { detectedType: detectBinaryType(buf) };
        case 'is_binary':
            return { isBinary: isBinaryFile(buf) };
        case 'describe':
            return { description: getBinaryDescription(typeName) };
        case 'mime':
            return { mimeType: getMimeFromType(typeName) };
        default:
            return { success: false, error: `Acción desconocida: "${action}". Usa: detect, is_binary, describe, mime` };
    }
}

export default {
    name: 'file_type_detector',
    description,
    parameters,
    handler
};
