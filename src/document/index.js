/**
 * ─── Document Module — Public API ───────────────────────────────────────────
 *
 * Punto de entrada único para el módulo de procesamiento de documentos.
 * Exporta todas las funciones públicas de converter.js y ocr.js.
 *
 * v1.0 — Junio 2026
 *
 * @module document
 */

export { convertToMarkdown, checkConverters, detectType } from "./converter.js";
export { ocrImage, checkOCR, isImage } from "./ocr.js";

/**
 * Convierte cualquier documento o imagen a Markdown.
 * Auto-detecta el tipo de archivo por extensión.
 *
 * @param {string|Buffer} input - Ruta del archivo o Buffer
 * @param {object} [options]
 * @param {string} [options.type] - Forzar tipo ('pdf', 'docx', 'xlsx', 'html', 'pptx', 'image')
 * @param {string} [options.lang] - Idioma para OCR ('spa+eng', 'eng', etc.)
 * @param {string} [options.ocrMethod] - Método OCR ('auto', 'tesseract', 'vision')
 * @returns {Promise<{success: boolean, content: string, type: string, meta: object, error?: string}>}
 *
 * @example
 * import { convertToMarkdown } from './document/index.js';
 * const result = await convertToMarkdown('reporte.pdf');
 * console.log(result.content); // Markdown del PDF
 */
export async function toMarkdown(input, options = {}) {
  const { convertToMarkdown: convert } = await import("./converter.js");
  const { ocrImage } = await import("./ocr.js");

  // Si es imagen o se fuerza tipo image, usar OCR
  const type = options.type || "";
  const isImageFile = typeof input === "string" && /\.(png|jpg|jpeg|gif|bmp|tiff|webp)$/i.test(input);

  if (type === "image" || isImageFile) {
    const result = await ocrImage(input, {
      method: options.ocrMethod || "auto",
      lang: options.lang || "spa+eng",
    });

    return {
      success: result.success,
      content: result.text,
      type: "image",
      meta: {
        ocrMethod: result.method,
        confidence: result.confidence,
      },
      error: result.error,
    };
  }

  // Para otros tipos, usar el convertidor
  return await convert(input, options);
}

export default { toMarkdown, convertToMarkdown, ocrImage, checkConverters, checkOCR };
