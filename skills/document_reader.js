/**
 * Document Reader — Any document → Markdown → LLM. Saves 70-85% tokens.
 * Supports: PDF, DOCX, XLSX, PPTX, HTML, images (OCR).
 */
import { convertToMarkdown, checkConverters } from "../src/document/converter.js";
import { ocrImage, checkOCR } from "../src/document/ocr.js";

export default {
  name: "document_reader",
  description: "Reads documents by converting them to Markdown for LLM analysis. Supports PDF, DOCX, XLSX, PPTX, HTML, images (OCR). Actions: read (convert to MD), info (metadata only), check (verify converters).",
  parameters: {
    type: "object", properties: {
      action: { type: "string", enum: ["read", "info", "check"], description: "read: convert doc to MD. info: show metadata. check: verify converters." },
      filePath: { type: "string", description: "Path to file. E.g.: ./report.pdf, C:/docs/report.docx" },
      type: { type: "string", enum: ["pdf","docx","xlsx","pptx","html","image","auto"], description: "Force document type. Default: auto-detect." },
      lang: { type: "string", description: "OCR language. Default: spa+eng." },
      ocrMethod: { type: "string", enum: ["auto","tesseract","vision"], description: "OCR method." },
      maxLength: { type: "number", description: "Max chars to return. Default: 50000. 0 = unlimited." },
    }, required: ["action"],
  },
  handler: async (p) => {
    switch (p.action) {
      case "read": return await _read(p);
      case "info": return await _info(p);
      case "check": return await _check();
      default: return { success: false, error: `Unknown action: ${p.action}` };
    }
  },
};

async function _read(p) {
  if (!p.filePath) return { success: false, error: "filePath required" };
  const isImg = /\.(png|jpg|jpeg|gif|bmp|tiff|webp)$/i.test(p.filePath);
  const type = p.type || (isImg ? "image" : "auto");

  try {
    let result;
    if (type === "image" || isImg) {
      result = await ocrImage(p.filePath, { method: p.ocrMethod || "auto", lang: p.lang || "spa+eng" });
      if (!result.success) return { success: false, error: result.error, filePath: p.filePath };
    } else {
      result = await convertToMarkdown(p.filePath, { type });
      if (!result.success) return { success: false, error: result.error, filePath: p.filePath };
    }
    const content = _trunc(result.content || result.text, p.maxLength);
    return { success: true, filePath: p.filePath, type: type, content, length: (result.content||result.text).length, truncated: content.length < (result.content||result.text).length, meta: result.meta, compressionRatio: result.meta?.compressionRatio };
  } catch (err) {
    return { success: false, error: err.message, filePath: p.filePath };
  }
}

async function _info(p) {
  if (!p.filePath) return { success: false, error: "filePath required" };
  const r = await convertToMarkdown(p.filePath, { type: p.type });
  if (!r.success) return { success: false, error: r.error };
  return { success: true, filePath: p.filePath, type: r.meta.type, meta: r.meta, preview: r.content.slice(0, 500) + (r.content.length > 500 ? "..." : "") };
}

async function _check() {
  const c = await checkConverters(), o = await checkOCR();
  const a = [], m = [];
  if (c.markitdown) a.push("MarkItDown (Microsoft) — PREFERIDO"); else m.push("MarkItDown — pip install markitdown");
  if (c.pdf) a.push("pdf-parse"); else m.push("pdf-parse — npm install pdf-parse");
  if (c.docx) a.push("mammoth"); else m.push("mammoth — npm install mammoth");
  if (c.xlsx) a.push("xlsx"); else m.push("xlsx — npm install xlsx");
  if (c.html) a.push("turndown"); else m.push("turndown — npm install turndown");
  if (o.tesseract) a.push("tesseract.js"); else m.push("tesseract.js — npm install tesseract.js");
  if (o.vision) a.push("Vision API"); else m.push("Vision API — Set GEMINI_API_KEY or OPENAI_API_KEY");
  return { success: true, available: a, missing: m, summary: `${a.length} available, ${m.length} missing` };
}

function _trunc(c, max) {
  const limit = max || 50000;
  if (limit <= 0 || c.length <= limit) return c;
  return c.slice(0, limit) + `\n\n*[truncated at ${limit} chars]*`;
}
