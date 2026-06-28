/**
 * OCR — Image to Markdown. Uses Tesseract.js (local) or Vision API (Gemini/GPT-4o).
 * Install: npm install tesseract.js
 */
const _cache = new Map();
async function _load(name, pkg) {
  if (_cache.has(name)) return _cache.get(name);
  try { const m = await import(pkg); _cache.set(name, m); return m; }
  catch { return null; }
}

const IMG_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif", ".webp"]);
export function isImage(fp) { return IMG_EXTS.has(path.extname(fp).toLowerCase()); }

async function tesseractOCR(buf, opts = {}) {
  const T = await _load("tesseract.js", "tesseract.js");
  if (!T) throw new Error("tesseract.js not installed. Run: npm install tesseract.js");
  const createWorker = T.createWorker || T.default?.createWorker;
  const w = await createWorker(opts.lang || "spa+eng");
  try {
    const { data } = await w.recognize(buf);
    return { text: (data.text || "").trim(), confidence: Math.round((data.confidence || 0) * 100) / 100, words: data.words?.length || 0 };
  } finally { await w.terminate(); }
}

async function visionOCR(buf, opts = {}) {
  const provider = opts.provider || "gemini";
  const key = opts.apiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Set GEMINI_API_KEY or OPENAI_API_KEY in .env");
  const b64 = buf.toString("base64");
  const mime = _detectMime(buf);
  const prompt = "Extract all text from this image. Return ONLY the text, preserving structure (paragraphs, lists, tables). No commentary.";

  if (provider === "gemini") {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }] }),
    });
    if (!r.ok) throw new Error(`Gemini API error: ${r.status}`);
    const d = await r.json();
    return { text: (d.candidates?.[0]?.content?.parts?.[0]?.text || "").trim(), provider: "gemini" };
  } else {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }] }], max_tokens: 4096 }),
    });
    if (!r.ok) throw new Error(`OpenAI API error: ${r.status}`);
    const d = await r.json();
    return { text: (d.choices?.[0]?.message?.content || "").trim(), provider: "openai" };
  }
}

function _detectMime(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp";
  return "image/png";
}

export async function ocrImage(input, options = {}) {
  try {
    let buf;
    if (Buffer.isBuffer(input)) buf = input;
    else if (typeof input === "string") {
      if (input.startsWith("http")) {
        const r = await fetch(input);
        if (!r.ok) return { success: false, text: "", error: `HTTP ${r.status}` };
        buf = Buffer.from(await r.arrayBuffer());
      } else {
        try { buf = require("fs").readFileSync(input); } catch { return { success: false, text: "", error: `File not found: ${input}` }; }
      }
    } else return { success: false, text: "", error: "Expected Buffer or file path" };

    const method = options.method || "auto";
    if (method === "auto" || method === "tesseract") {
      try {
        const r = await tesseractOCR(buf, { lang: options.lang || "spa+eng" });
        if (r.text.length > 10 || method === "tesseract") return { success: true, text: r.text, method: "tesseract", confidence: r.confidence };
      } catch (e) { if (method === "tesseract") return { success: false, text: "", error: e.message }; }
    }
    const r = await visionOCR(buf, { provider: options.provider || "gemini", apiKey: options.apiKey });
    return { success: true, text: r.text, method: `vision:${r.provider}`, confidence: 95 };
  } catch (err) {
    return { success: false, text: "", error: err.message };
  }
}

export async function checkOCR() {
  const t = !!await _load("tesseract.js", "tesseract.js");
  const v = !!(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
  return { tesseract: t, vision: v };
}

import path from "path";
export default { ocrImage, checkOCR, isImage };
