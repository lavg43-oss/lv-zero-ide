/**
 * Computer Use — Vision + CDP Browser Automation.
 * Uses Electron CDP (Chrome DevTools Protocol) for browsing — no Playwright needed.
 * CDP is native to Electron, zero overhead, instant screenshots via capturePage().
 * Actions: navigate (browse + analyze), screenshot (URL via CDP), screen (OS), analyze (image), find (element), compare (before/after).
 */
import { analyzeScreenshot, compareScreenshots, findElement } from "../src/vision/analyzer.js";
import { captureScreen } from "../src/vision/screenshot.js";

// CDP sessions cache (keyed by URL for reuse)
const _sessions = new Map();

async function _cdpOpen(url) {
  // Reuse existing session for same URL
  if (_sessions.has(url)) return _sessions.get(url);
  // Need IPC to main process — this runs in renderer, so use window.lvzero
  if (typeof window !== "undefined" && window.lvzero) {
    const r = await window.lvzero["browser:open"](url);
    if (r.success) { _sessions.set(url, r.sessionId); return r.sessionId; }
    throw new Error(r.error);
  }
  throw new Error("CDP browser not available (not in Electron renderer)");
}

async function _cdpCmd(sessionId, cmd, ...args) {
  if (typeof window !== "undefined" && window.lvzero && window.lvzero[`browser:${cmd}`]) {
    return await window.lvzero[`browser:${cmd}`](sessionId, ...args);
  }
  throw new Error(`browser:${cmd} not available`);
}

export default {
  name: "computer_use",
  description: "Computer Use — vision + CDP browser automation. Uses Electron CDP (Chrome DevTools Protocol) for browsing — zero overhead, instant screenshots. Actions: navigate (browse+analyze), screenshot (URL via CDP), screen (OS), analyze (image), find (element by description), compare (before/after).",
  parameters: {
    type: "object", properties: {
      action: { type: "string", enum: ["navigate","screenshot","screen","analyze","find","compare"], description: "navigate: browse URL + analyze. screenshot: capture URL via CDP. screen: capture OS. analyze: analyze image. find: find element. compare: before/after." },
      url: { type: "string", description: "URL for navigate/screenshot." },
      imagePath: { type: "string", description: "Image path for analyze/find." },
      targetDescription: { type: "string", description: "Element description for find. E.g.: 'the blue login button'" },
      beforeImage: { type: "string", description: "Before image for compare." },
      afterImage: { type: "string", description: "After image for compare." },
      prompt: { type: "string", description: "Custom vision prompt." },
      provider: { type: "string", enum: ["gemini","openai","anthropic"], description: "Vision provider. Default: gemini." },
    }, required: ["action"],
  },
  handler: async (p) => {
    switch (p.action) {
      case "navigate": return await _navigate(p);
      case "screenshot": return await _screenshot(p);
      case "screen": return await _screen(p);
      case "analyze": return await _analyze(p);
      case "find": return await _find(p);
      case "compare": return await _compare(p);
      default: return { success: false, error: `Unknown: ${p.action}` };
    }
  },
};

async function _navigate(p) {
  if (!p.url) return { success: false, error: "url required" };
  try {
    const sid = await _cdpOpen(p.url);
    // Get screenshot via CDP
    const shot = await _cdpCmd(sid, "screenshot");
    if (!shot.success) return { success: false, error: shot.error };

    // Analyze with vision AI
    if (p.provider) {
      const buf = Buffer.from(shot.screenshot, "base64");
      const analysis = await analyzeScreenshot(buf, { prompt: p.prompt, provider: p.provider || "gemini" });
      return { success: true, url: p.url, sessionId: sid, screenshot: { size: shot.size, format: "base64" }, analysis: analysis.success ? analysis.description : undefined, analysisError: analysis.success ? undefined : analysis.error };
    }
    return { success: true, url: p.url, sessionId: sid, screenshot: { size: shot.size, format: "base64" } };
  } catch (err) { return { success: false, error: err.message }; }
}

async function _screenshot(p) {
  if (!p.url) return { success: false, error: "url required" };
  try {
    const sid = await _cdpOpen(p.url);
    const shot = await _cdpCmd(sid, "screenshot");
    return shot.success ? { success: true, url: p.url, screenshot: { data: shot.screenshot, size: shot.size }, sessionId: sid } : { success: false, error: shot.error };
  } catch (err) { return { success: false, error: err.message }; }
}

async function _screen(p) {
  const r = await captureScreen();
  if (!r.success) return { success: false, error: r.error };
  if (p.provider && r.buffer) {
    const a = await analyzeScreenshot(r.buffer, { provider: p.provider });
    return { success: true, screenshot: { path: r.path, size: r.size }, analysis: a.success ? a.description : undefined };
  }
  return { success: true, screenshot: { path: r.path, size: r.size } };
}

async function _analyze(p) {
  if (!p.imagePath) return { success: false, error: "imagePath required" };
  try {
    const fs = await import("fs");
    const r = await analyzeScreenshot(fs.readFileSync(p.imagePath), { prompt: p.prompt, provider: p.provider || "gemini" });
    return r.success ? { success: true, description: r.description, provider: r.provider } : { success: false, error: r.error };
  } catch (err) { return { success: false, error: err.message }; }
}

async function _find(p) {
  if (!p.imagePath) return { success: false, error: "imagePath required" };
  if (!p.targetDescription) return { success: false, error: "targetDescription required" };
  try {
    const fs = await import("fs");
    return await findElement(fs.readFileSync(p.imagePath), p.targetDescription, { provider: p.provider || "gemini" });
  } catch (err) { return { success: false, found: false, error: err.message }; }
}

async function _compare(p) {
  if (!p.beforeImage || !p.afterImage) return { success: false, error: "beforeImage and afterImage required" };
  try {
    const fs = await import("fs");
    return await compareScreenshots(fs.readFileSync(p.beforeImage), fs.readFileSync(p.afterImage), { provider: p.provider || "gemini" });
  } catch (err) { return { success: false, changes: [], summary: "", error: err.message }; }
}
