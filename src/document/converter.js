/**
 * Document → Markdown converter.
 * Philosophy: Any doc → MD → LLM. MD is native LLM format, saves 70-85% tokens.
 * Backends (tried in order): MarkItDown (Python, Microsoft) > pdf-parse > mammoth > xlsx > turndown
 * Install MarkItDown: pip install markitdown
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const _cache = new Map();
async function _load(name, pkg) {
  if (_cache.has(name)) return _cache.get(name);
  try { const m = await import(pkg); _cache.set(name, m); return m; }
  catch { return null; }
}

/** Check if MarkItDown (Python) is available */
function _hasMarkitdown() {
  try { execSync("markitdown --help", { stdio: "ignore", timeout: 5000 }); return true; }
  catch { return false; }
}
let _markitdownAvail = null;
async function _checkMarkitdown() {
  if (_markitdownAvail === null) _markitdownAvail = _hasMarkitdown();
  return _markitdownAvail;
}

/**
 * Convert using MarkItDown (Microsoft Python tool). Supports PDF, DOCX, XLSX, PPTX, HTML, images.
 * Tried first as it's the most robust converter.
 */
async function _markitdownToMd(filePath) {
  if (!(await _checkMarkitdown())) return null;
  try {
    const out = execSync(`markitdown "${filePath.replace(/"/g, '\\"')}"`, { encoding: "utf-8", timeout: 30000, maxBuffer: 50 * 1024 * 1024 });
    return { content: out.trim(), meta: { converter: "markitdown" } };
  } catch (err) {
    return { content: "", meta: { converter: "markitdown", error: err.message } };
  }
}

async function pdfToMd(input) {
  const fp = typeof input === "string" ? input : null;
  // Try MarkItDown first (preferred)
  if (fp) {
    const md = await _markitdownToMd(fp);
    if (md && md.content) return md;
  }
  // Fallback to pdf-parse
  const pdf = await _load("pdf-parse", "pdf-parse");
  if (!pdf) return { content: `> ⚠️ Install: npm install pdf-parse or pip install markitdown`, meta: {} };
  const buf = fp ? fs.readFileSync(fp) : input;
  const data = await pdf(buf);
  let md = (data.text || "").replace(/\f/g, "\n\n---\n\n");
  md = md.replace(/^([A-Z][A-Z\s\-]+)$/gm, m => m.trim().length < 60 ? `## ${m.trim()}` : m);
  return { content: md.trim(), meta: { pages: data.numpages || 0, chars: data.text?.length || 0 } };
}

async function docxToMd(input) {
  const fp = typeof input === "string" ? input : null;
  if (fp) {
    const md = await _markitdownToMd(fp);
    if (md && md.content) return md;
  }
  const mm = await _load("mammoth", "mammoth");
  if (!mm) return { content: `> ⚠️ Install: npm install mammoth or pip install markitdown`, meta: {} };
  const opts = Buffer.isBuffer(input) ? { buffer: input } : { path: input };
  const r = await mm.convertToMarkdown(opts);
  return { content: r.value || "", meta: { warnings: r.messages?.filter(m => m.type === "warning").length || 0 } };
}

async function xlsxToMd(input) {
  const fp = typeof input === "string" ? input : null;
  if (fp) {
    const md = await _markitdownToMd(fp);
    if (md && md.content) return md;
  }
  const X = await _load("xlsx", "xlsx");
  if (!X) return { content: `> ⚠️ Install: npm install xlsx or pip install markitdown`, meta: {} };
  const wb = Buffer.isBuffer(input) ? X.read(input, { type: "buffer" }) : X.readFile(input);
  let md = "";
  for (const name of wb.SheetNames) {
    const json = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    if (!json.length) continue;
    if (wb.SheetNames.length > 1) md += `## ${name}\n\n`;
    const h = json[0];
    md += `| ${h.join(" | ")} |\n| ${h.map(() => "---").join(" | ")} |\n`;
    for (const row of json.slice(1)) {
      if (row.every(c => String(c).trim() === "")) continue;
      md += `| ${row.map(c => String(c).replace(/\|/g, "\\|")).join(" | ")} |\n`;
    }
    md += `\n*${json.length - 1} rows*\n\n`;
  }
  return { content: md.trim(), meta: { sheets: wb.SheetNames.length } };
}

async function htmlToMd(html) {
  const td = await _load("turndown", "turndown");
  if (!td) {
    const text = html.replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return { content: text, meta: { warning: "turndown not installed" } };
  }
  const s = new (td.default || td)({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  return { content: s.turndown(html).trim(), meta: {} };
}

async function pptxToMd(input) {
  const fp = typeof input === "string" ? input : null;
  if (fp) {
    const md = await _markitdownToMd(fp);
    if (md && md.content) return md;
  }
  return { content: `> ⚠️ Install: pip install markitdown for PPTX support`, meta: {} };
}

async function imageToMd(input) {
  const fp = typeof input === "string" ? input : null;
  if (fp) {
    const md = await _markitdownToMd(fp);
    if (md && md.content) return md;
  }
  return { content: "", meta: { warning: "pip install markitdown for image OCR support" } };
}

const EXT_MAP = {
  ".pdf": "pdf", ".docx": "docx", ".doc": "docx",
  ".xlsx": "xlsx", ".xls": "xlsx", ".csv": "csv",
  ".pptx": "pptx", ".ppt": "pptx",
  ".html": "html", ".htm": "html",
  ".md": "markdown", ".txt": "text", ".json": "json",
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".bmp": "image", ".tiff": "image", ".webp": "image",
};

function detectType(fp, mime) {
  if (mime) {
    const m = { "application/pdf": "pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx", "text/html": "html", "text/markdown": "markdown", "text/plain": "text" };
    if (m[mime]) return m[mime];
  }
  return EXT_MAP[path.extname(fp).toLowerCase()] || "unknown";
}

export async function convertToMarkdown(input, options = {}) {
  try {
    let fp = "", buf = null;
    if (Buffer.isBuffer(input)) { buf = input; }
    else if (typeof input === "string") {
      if (input.trim().startsWith("<")) return await htmlToMd(input);
      if (!fs.existsSync(input)) return { success: false, error: `File not found: ${input}`, content: "", meta: {} };
      fp = input; buf = fs.readFileSync(input);
    } else return { success: false, error: "Expected file path (string) or Buffer", content: "", meta: {} };

    const type = options.type || detectType(fp, options.mimeType);
    let result;

    switch (type) {
      case "pdf": result = await pdfToMd(fp || buf); break;
      case "docx": result = await docxToMd(fp || buf); break;
      case "xlsx": case "csv": result = await xlsxToMd(fp || buf); break;
      case "pptx": result = await pptxToMd(fp || buf); break;
      case "html": result = await htmlToMd(buf.toString("utf-8")); break;
      case "image": result = await imageToMd(fp || buf); break;
      case "markdown": return { success: true, content: buf.toString("utf-8"), meta: { type: "markdown" } };
      case "text": case "json": return { success: true, content: "```" + type + "\n" + buf.toString("utf-8") + "\n```", meta: { type } };
      default: return { success: false, error: `Unsupported: ${type}. Supported: pdf, docx, xlsx, pptx, html, image`, content: "", meta: {} };
    }

    return {
      success: true,
      content: result.content,
      meta: { ...result.meta, type, originalPath: fp, originalSize: buf.length, convertedSize: result.content.length, compressionRatio: buf.length > 0 ? Math.round((1 - result.content.length / buf.length) * 100) : 0 },
    };
  } catch (err) {
    return { success: false, error: err.message, content: "", meta: {} };
  }
}

export async function checkConverters() {
  const [pdf, docx, xlsx, html, markitdown] = await Promise.all([
    _load("pdf-parse", "pdf-parse").then(m => !!m),
    _load("mammoth", "mammoth").then(m => !!m),
    _load("xlsx", "xlsx").then(m => !!m),
    _load("turndown", "turndown").then(m => !!m),
    _checkMarkitdown(),
  ]);
  return { pdf, docx, xlsx, html, markitdown };
}

export default { convertToMarkdown, checkConverters, detectType };
