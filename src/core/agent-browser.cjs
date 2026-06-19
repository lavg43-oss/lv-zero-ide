/**
 * agent-browser.cjs — Browser automation via Electron BrowserView/BrowserWindow
 *
 * Provides programmatic browser control for testing and previewing web apps
 * directly inside the lv-zero IDE. Uses Electron's built-in Chromium engine
 * (BrowserWindow as hidden headless session) — no external dependencies needed.
 *
 * Architecture:
 *   Main process manages BrowserWindow sessions (one per "browser session").
 *   The renderer process manages a <webview> tag for user-visible browsing.
 *   This module is the main-process bridge that handles IPC from the renderer.
 *
 * Sessions tracked in: { [sessionId]: { win, webContents, url, logs } }
 */

const { BrowserWindow, session: electronSession } = require("electron");
const path = require("path");

// ─── Session Store ───────────────────────────────────────────────────────────
const sessions = {};

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Generate a short unique session ID.
 */
function generateSessionId() {
  return "browser_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

/**
 * Resolve a session by ID. Throws if not found.
 */
function getSession(sessionId) {
  const session = sessions[sessionId];
  if (!session) {
    throw new Error(`Browser session not found: ${sessionId}`);
  }
  return session;
}

/**
 * Safely execute JS in a webContents context with error handling.
 */
async function safeExecute(webContents, code) {
  try {
    const result = await webContents.executeJavaScript(code);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Browser Lifecycle ───────────────────────────────────────────────────────

/**
 * openBrowser(url, options) — Opens a new hidden BrowserWindow for automation.
 *
 * @param {string} url - URL to navigate to
 * @param {object} [options] - Optional settings { width, height, headless, show }
 * @returns {{ sessionId: string, url: string }}
 */
async function openBrowser(url, options = {}) {
  const sessionId = generateSessionId();
  const show = options.show === true; // Default hidden for automation
  const width = options.width || 1024;
  const height = options.height || 768;

  const win = new BrowserWindow({
    width,
    height,
    show,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false,
      sandbox: true,
    },
  });

  // If visible, position off-center to avoid overlapping main window
  if (show) {
    win.setAlwaysOnTop(false);
  }

  // Capture console messages
  const logs = [];
  win.webContents.on("console-message", (_event, level, message) => {
    logs.push({
      level: ["verbose", "info", "warning", "error"][level] || "info",
      message,
      timestamp: new Date().toISOString(),
    });
  });

  // Navigate
  try {
    await win.loadURL(url);
  } catch (err) {
    // Some pages may fail to load (e.g., invalid cert), that's OK for automation
    console.warn(`[AgentBrowser] loadURL warning for ${url}:`, err.message);
  }

  const session = {
    id: sessionId,
    win,
    webContents: win.webContents,
    url: win.webContents.getURL() || url,
    logs,
    createdAt: new Date().toISOString(),
  };

  sessions[sessionId] = session;

  return { sessionId, url: session.url };
}

/**
 * navigate(sessionId, url) — Navigates an existing session to a URL.
 */
async function navigate(sessionId, url) {
  const session = getSession(sessionId);
  try {
    await session.webContents.loadURL(url);
    session.url = session.webContents.getURL();
    return { success: true, url: session.url };
  } catch (err) {
    console.warn(`[AgentBrowser] navigate warning for ${url}:`, err.message);
    session.url = session.webContents.getURL() || url;
    return { success: true, url: session.url, warning: err.message };
  }
}

/**
 * executeScript(sessionId, code) — Runs JavaScript in the page context.
 */
async function executeScript(sessionId, code) {
  const session = getSession(sessionId);
  return safeExecute(session.webContents, code);
}

/**
 * getPageContent(sessionId) — Returns the current page's outer HTML.
 */
async function getPageContent(sessionId) {
  const session = getSession(sessionId);
  return safeExecute(session.webContents, "document.documentElement.outerHTML");
}

/**
 * takeScreenshot(sessionId) — Returns a base64-encoded PNG screenshot.
 */
async function takeScreenshot(sessionId) {
  const session = getSession(sessionId);
  try {
    const image = await session.webContents.capturePage();
    const buffer = image.toPNG();
    const base64 = buffer.toString("base64");
    return { success: true, data: `data:image/png;base64,${base64}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * clickElement(sessionId, selector) — Clicks an element by CSS selector.
 */
async function clickElement(sessionId, selector) {
  const session = getSession(sessionId);
  const code = `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { success: false, error: "Element not found: ${JSON.stringify(selector)}" };
      el.click();
      return { success: true };
    })()
  `;
  return safeExecute(session.webContents, code);
}

/**
 * fillInput(sessionId, selector, value) — Fills an input field by CSS selector.
 */
async function fillInput(sessionId, selector, value) {
  const session = getSession(sessionId);
  const code = `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { success: false, error: "Element not found: ${JSON.stringify(selector)}" };
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      ).set;
      nativeInputValueSetter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };
    })()
  `;
  return safeExecute(session.webContents, code);
}

/**
 * getElementText(sessionId, selector) — Returns text content of an element.
 */
async function getElementText(sessionId, selector) {
  const session = getSession(sessionId);
  const code = `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { success: false, error: "Element not found: ${JSON.stringify(selector)}" };
      return { success: true, text: el.textContent.trim() };
    })()
  `;
  return safeExecute(session.webContents, code);
}

/**
 * waitForSelector(sessionId, selector, timeout) — Waits for an element to appear.
 */
async function waitForSelector(sessionId, selector, timeout = 5000) {
  const session = getSession(sessionId);
  const code = `
    (() => {
      return new Promise((resolve, reject) => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) return resolve({ success: true });
        const timeoutId = setTimeout(() => {
          observer.disconnect();
          resolve({ success: false, error: "Timeout waiting for: ${JSON.stringify(selector)}" });
        }, ${timeout});
        const observer = new MutationObserver(() => {
          if (document.querySelector(${JSON.stringify(selector)})) {
            clearTimeout(timeoutId);
            observer.disconnect();
            resolve({ success: true });
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });
    })()
  `;
  return safeExecute(session.webContents, code);
}

/**
 * getConsoleLogs(sessionId) — Returns captured console output for a session.
 */
function getConsoleLogs(sessionId) {
  const session = getSession(sessionId);
  return { success: true, logs: session.logs };
}

/**
 * closeBrowser(sessionId) — Closes a browser session and cleans up.
 */
async function closeBrowser(sessionId) {
  const session = sessions[sessionId];
  if (!session) {
    return { success: false, error: `Session not found: ${sessionId}` };
  }
  try {
    if (session.win && !session.win.isDestroyed()) {
      session.win.close();
    }
  } catch (err) {
    console.warn(`[AgentBrowser] Error closing session ${sessionId}:`, err.message);
  }
  delete sessions[sessionId];
  return { success: true };
}

/**
 * listSessions() — Returns a summary of all active sessions.
 */
function listSessions() {
  return Object.values(sessions).map((s) => ({
    id: s.id,
    url: s.url,
    createdAt: s.createdAt,
    logCount: s.logs.length,
  }));
}

// ─── IPC Handler Factory ─────────────────────────────────────────────────────
// Returns an object with all handler functions for easy registration in main.cjs

function createHandlers() {
  return {
    "browser:open": async (_event, url, options) => {
      try {
        return await openBrowser(url, options);
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    "browser:navigate": async (_event, sessionId, url) => {
      try {
        return await navigate(sessionId, url);
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    "browser:execute-script": async (_event, sessionId, code) => {
      try {
        return await executeScript(sessionId, code);
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    "browser:get-content": async (_event, sessionId) => {
      try {
        return await getPageContent(sessionId);
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    "browser:screenshot": async (_event, sessionId) => {
      try {
        return await takeScreenshot(sessionId);
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    "browser:click": async (_event, sessionId, selector) => {
      try {
        return await clickElement(sessionId, selector);
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    "browser:fill": async (_event, sessionId, selector, value) => {
      try {
        return await fillInput(sessionId, selector, value);
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    "browser:get-text": async (_event, sessionId, selector) => {
      try {
        return await getElementText(sessionId, selector);
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    "browser:wait-for": async (_event, sessionId, selector, timeout) => {
      try {
        return await waitForSelector(sessionId, selector, timeout);
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    "browser:logs": async (_event, sessionId) => {
      try {
        return getConsoleLogs(sessionId);
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    "browser:close": async (_event, sessionId) => {
      try {
        return await closeBrowser(sessionId);
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    "browser:list-sessions": async () => {
      try {
        return listSessions();
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  };
}

module.exports = {
  openBrowser,
  navigate,
  executeScript,
  getPageContent,
  takeScreenshot,
  clickElement,
  fillInput,
  getElementText,
  waitForSelector,
  getConsoleLogs,
  closeBrowser,
  listSessions,
  createHandlers,
};
