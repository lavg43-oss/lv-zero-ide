/**
 * browser_automation — Browser Automation Skill
 *
 * Phase 3: Browser Automation Daemon (gstack-inspired)
 *
 * Wraps the BrowserDaemon as an lv-zero skill.
 * Allows the agent to:
 *   - Launch/stop a headless Chromium browser
 *   - Navigate to URLs and interact with pages
 *   - Take screenshots and snapshots
 *   - Extract content and data
 *   - Manage tabs and cookies
 *   - Execute JavaScript in page context
 *
 * @module skills/browser_automation
 */

import BrowserDaemon from "../src/browser/daemon.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton Daemon Instance
// ═══════════════════════════════════════════════════════════════════════════════

/** @type {BrowserDaemon|null} */
let daemon = null;

/**
 * Gets or creates the singleton BrowserDaemon instance.
 * @returns {BrowserDaemon}
 */
function getDaemon() {
  if (!daemon) {
    daemon = new BrowserDaemon({
      headless: process.env.BROWSER_HEADLESS !== "false",
      idleTimeoutMs: parseInt(process.env.BROWSER_IDLE_TIMEOUT || "1800000", 10),
      auth: process.env.BROWSER_AUTH !== "false",
      rateLimit: parseInt(process.env.BROWSER_RATE_LIMIT || "10", 10),
    });

    // Forward daemon events to console
    daemon.on("log", (msg) => console.log(msg));
    daemon.on("error", ({ phase, error }) => console.warn(`   ⚠️ Browser ${phase}: ${error}`));
  }
  return daemon;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Skill Definition
// ═══════════════════════════════════════════════════════════════════════════════

export default {
  name: "browser_automation",
  description:
    "Browser automation using headless Chromium (Playwright). " +
    "Allows navigating to URLs, clicking elements, typing text, taking screenshots, " +
    "extracting content, managing tabs and cookies, and executing JavaScript. " +
    "The browser stays running between commands for fast execution (~100ms per command after first call). " +
    "Auto-shuts down after 30 minutes of inactivity. " +
    "Actions: start, stop, navigate, click, type, snapshot, screenshot, extract, " +
    "scroll, wait, evaluate, cookies, hover, select, upload, press, reload, back, " +
    "getAttribute, getHtml, newTab, switchTab, listTabs, closeTab, status.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "start", "stop", "restart",
          "navigate", "click", "type", "snapshot", "screenshot",
          "extract", "scroll", "wait", "evaluate", "cookies",
          "hover", "select", "upload", "press", "reload", "back",
          "getAttribute", "getHtml",
          "newTab", "switchTab", "listTabs", "closeTab",
          "status",
        ],
        description:
          "Browser action to execute:\n" +
          "- 'start' → Launch the browser daemon\n" +
          "- 'stop' → Stop the browser daemon\n" +
          "- 'restart' → Restart the browser daemon\n" +
          "- 'navigate' → Go to a URL (requires: url)\n" +
          "- 'click' → Click an element (requires: selector)\n" +
          "- 'type' → Type text into an input (requires: selector, text)\n" +
          "- 'snapshot' → Take page snapshot (URL, title, screenshot, text)\n" +
          "- 'screenshot' → Take a screenshot (optional: fullPage, selector)\n" +
          "- 'extract' → Extract text from element (requires: selector)\n" +
          "- 'scroll' → Scroll page (optional: x, y, direction, amount)\n" +
          "- 'wait' → Wait for selector or timeout\n" +
          "- 'evaluate' → Run JavaScript in page (requires: script)\n" +
          "- 'cookies' → Get/set cookies\n" +
          "- 'hover' → Hover over element (requires: selector)\n" +
          "- 'select' → Select dropdown option (requires: selector, value)\n" +
          "- 'upload' → Upload file (requires: selector, filePath)\n" +
          "- 'press' → Press keyboard key (requires: key)\n" +
          "- 'reload' → Reload current page\n" +
          "- 'back' → Go back in history\n" +
          "- 'getAttribute' → Get element attribute (requires: selector, attribute)\n" +
          "- 'getHtml' → Get element HTML (requires: selector)\n" +
          "- 'newTab' → Open new tab (optional: url)\n" +
          "- 'switchTab' → Switch to tab by index (requires: index)\n" +
          "- 'listTabs' → List all open tabs\n" +
          "- 'closeTab' → Close tab by index (requires: index)\n" +
          "- 'status' → Get daemon status",
      },
      url: {
        type: "string",
        description: "URL for navigate action. Example: https://example.com",
      },
      selector: {
        type: "string",
        description: "CSS selector for click/type/extract/hover/select/upload/press actions. Example: #submit-btn, .class-name, input[name='email']",
      },
      text: {
        type: "string",
        description: "Text to type (for type action).",
      },
      script: {
        type: "string",
        description: "JavaScript code to evaluate (for evaluate action).",
      },
      key: {
        type: "string",
        description: "Keyboard key to press (for press action). Example: Enter, Escape, Tab, ArrowDown",
      },
      attribute: {
        type: "string",
        description: "Attribute name to get (for getAttribute action). Example: href, src, class",
      },
      value: {
        type: "string",
        description: "Value to select (for select action).",
      },
      filePath: {
        type: "string",
        description: "File path to upload (for upload action).",
      },
      index: {
        type: "number",
        description: "Tab index (for switchTab/closeTab actions). 0-based.",
      },
      fullPage: {
        type: "boolean",
        description: "Capture full page screenshot (for screenshot action, default: true).",
      },
      direction: {
        type: "string",
        enum: ["up", "down", "left", "right"],
        description: "Scroll direction (for scroll action).",
      },
      amount: {
        type: "number",
        description: "Scroll amount in pixels (for scroll action, default: 300).",
      },
      property: {
        type: "string",
        description: "Property to extract (for extract action). textContent, innerText, value, href, src",
      },
      timeout: {
        type: "number",
        description: "Timeout in ms (for wait/navigate actions).",
      },
    },
    required: ["action"],
  },

  handler: async (params, options = {}) => {
    const { action } = params;

    try {
      const d = getDaemon();

      switch (action) {
        // ── Lifecycle ──
        case "start":
          return await d.start();

        case "stop":
          await d.stop();
          return { success: true };

        case "restart":
          return await d.restart();

        // ── Browser Commands ──
        case "navigate":
          if (!params.url) return { success: false, error: "url is required for navigate action" };
          return await d.execute("navigate", { url: params.url, options: { timeout: params.timeout } });

        case "click":
          if (!params.selector) return { success: false, error: "selector is required for click action" };
          return await d.execute("click", { selector: params.selector });

        case "type":
          if (!params.selector) return { success: false, error: "selector is required for type action" };
          if (params.text === undefined) return { success: false, error: "text is required for type action" };
          return await d.execute("type", { selector: params.selector, text: params.text });

        case "snapshot":
          return await d.execute("snapshot", { fullPage: params.fullPage });

        case "screenshot":
          return await d.execute("screenshot", {
            fullPage: params.fullPage !== false,
            selector: params.selector,
          });

        case "extract":
          if (!params.selector) return { success: false, error: "selector is required for extract action" };
          return await d.execute("extract", {
            selector: params.selector,
            property: params.property || "textContent",
          });

        case "scroll":
          return await d.execute("scroll", {
            x: params.x,
            y: params.y,
            direction: params.direction,
            amount: params.amount,
          });

        case "wait":
          return await d.execute("wait", {
            selector: params.selector,
            timeout: params.timeout,
          });

        case "evaluate":
          if (!params.script) return { success: false, error: "script is required for evaluate action" };
          return await d.execute("evaluate", { script: params.script });

        case "cookies":
          return await d.execute("cookies", {});

        case "hover":
          if (!params.selector) return { success: false, error: "selector is required for hover action" };
          return await d.execute("hover", { selector: params.selector });

        case "select":
          if (!params.selector) return { success: false, error: "selector is required for select action" };
          if (!params.value) return { success: false, error: "value is required for select action" };
          return await d.execute("select", { selector: params.selector, value: params.value });

        case "upload":
          if (!params.selector) return { success: false, error: "selector is required for upload action" };
          if (!params.filePath) return { success: false, error: "filePath is required for upload action" };
          return await d.execute("upload", { selector: params.selector, filePath: params.filePath });

        case "press":
          if (!params.key) return { success: false, error: "key is required for press action" };
          return await d.execute("press", { key: params.key, selector: params.selector });

        case "reload":
          return await d.execute("reload", {});

        case "back":
          return await d.execute("back", {});

        case "getAttribute":
          if (!params.selector) return { success: false, error: "selector is required" };
          if (!params.attribute) return { success: false, error: "attribute is required" };
          return await d.execute("getAttribute", { selector: params.selector, attribute: params.attribute });

        case "getHtml":
          if (!params.selector) return { success: false, error: "selector is required" };
          return await d.execute("getHtml", { selector: params.selector });

        // ── Tab Management ──
        case "newTab":
          return await d.newTab(params.url);

        case "switchTab":
          if (params.index === undefined) return { success: false, error: "index is required for switchTab action" };
          return await d.switchTab(params.index);

        case "listTabs":
          return { success: true, tabs: d.listTabs() };

        case "closeTab":
          if (params.index === undefined) return { success: false, error: "index is required for closeTab action" };
          return await d.closeTab(params.index);

        // ── Status ──
        case "status":
          return { success: true, ...d.getStatus() };

        default:
          return { success: false, error: `Unknown action: "${action}". See description for available actions.` };
      }
    } catch (err) {
      return { success: false, error: `Browser automation error: ${err.message}` };
    }
  },
};
