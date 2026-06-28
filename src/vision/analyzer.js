/**
 * Vision Analyzer — AI-powered screenshot analysis.
 * Supports Gemini, GPT-4o, Claude. Requires API key in .env.
 */
const PROV = { GEMINI: "gemini", OPENAI: "openai", ANTHROPIC: "anthropic" };

function _key(p) {
  return p === PROV.GEMINI ? process.env.GEMINI_API_KEY : p === PROV.OPENAI ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
}

const DEFAULT_PROMPT = `Analyze this screenshot. Provide:
1. Summary (1-2 sentences)
2. UI elements (buttons, links, inputs, menus) with text labels
3. All visible text, preserving structure
4. Layout description (header, sidebar, main, footer)
5. Special states (loading, error, modal, empty)
6. Available user actions
Format as Markdown.`;

async function _gemini(b64, mime, prompt, key) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }] }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}`);
  return (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function _openai(b64, mime, prompt, key) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }] }], max_tokens: 4096 }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}`);
  return (await r.json()).choices?.[0]?.message?.content || "";
}

async function _anthropic(b64, mime, prompt, key) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-3-5-sonnet-20241022", max_tokens: 4096, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image", source: { type: "base64", media_type: mime, data: b64 } }] }] }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}`);
  return (await r.json()).content?.[0]?.text || "";
}

export async function analyzeScreenshot(buf, options = {}) {
  const provider = options.provider || PROV.GEMINI;
  const key = options.apiKey || _key(provider);
  if (!key) return { success: false, description: "", error: `No API key for ${provider}. Set ${provider === PROV.GEMINI ? "GEMINI_API_KEY" : provider === PROV.OPENAI ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} in .env` };

  const b64 = buf.toString("base64");
  const mime = "image/png";
  const prompt = options.prompt || DEFAULT_PROMPT;

  try {
    let text;
    if (provider === PROV.GEMINI) text = await _gemini(b64, mime, prompt, key);
    else if (provider === PROV.OPENAI) text = await _openai(b64, mime, prompt, key);
    else text = await _anthropic(b64, mime, prompt, key);
    return { success: true, description: text, provider };
  } catch (err) {
    return { success: false, description: "", error: err.message };
  }
}

export async function compareScreenshots(before, after, options = {}) {
  const provider = options.provider || PROV.GEMINI;
  const key = options.apiKey || _key(provider);
  if (!key) return { success: false, changes: [], summary: "", error: `No API key for ${provider}` };

  const b64b = before.toString("base64"), b64a = after.toString("base64");
  const mime = "image/png";
  const prompt = "Compare these 2 screenshots (BEFORE vs AFTER). List each change as a bullet point. Was an action performed? Any errors in AFTER? Format as Markdown.";

  try {
    let text;
    if (provider === PROV.GEMINI) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64b } }, { inline_data: { mime_type: mime, data: b64a } }] }] }),
      });
      if (!r.ok) throw new Error(`Gemini ${r.status}`);
      text = (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mime};base64,${b64b}` } }, { type: "image_url", image_url: { url: `data:${mime};base64,${b64a}` } }] }], max_tokens: 4096 }),
      });
      if (!r.ok) throw new Error(`OpenAI ${r.status}`);
      text = (await r.json()).choices?.[0]?.message?.content || "";
    }
    const changes = text.split("\n").filter(l => l.trim().startsWith("-") || l.trim().startsWith("*")).map(l => l.replace(/^[\s*\-]+/, "").trim());
    return { success: true, changes, summary: text, provider };
  } catch (err) {
    return { success: false, changes: [], summary: "", error: err.message };
  }
}

export async function findElement(buf, target, options = {}) {
  const r = await analyzeScreenshot(buf, { ...options, prompt: `Look at this screenshot. Find: "${target}". If found, describe what it is, its text/label, and location. If NOT found, say "NOT FOUND" and why.` });
  if (!r.success) return { success: false, found: false, error: r.error };
  return { success: true, found: !r.description.includes("NOT FOUND"), description: r.description };
}

export default { analyzeScreenshot, compareScreenshots, findElement };
