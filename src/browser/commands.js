/**
 * browser/commands — Browser Automation Commands ($B-style)
 *
 * Phase 3: Browser Automation Daemon (gstack-inspired)
 *
 * Implements gstack's $B-style browser commands:
 *   - snapshot    — Take page snapshot (screenshot + HTML + URL)
 *   - click       — Click element by selector
 *   - type        — Type text into input
 *   - screenshot  — Full page screenshot
 *   - navigate    — Go to URL
 *   - extract     — Extract text from selector
 *   - scroll      — Scroll page
 *   - wait        — Wait for selector or timeout
 *   - evaluate    — Run JavaScript in page context
 *   - cookies     — Get/set cookies
 *   - hover       — Hover over element
 *   - select      — Select option in dropdown
 *   - upload      — Upload file
 *   - press       — Press keyboard key
 *   - reload      — Reload page
 *   - back        - Go back in history
 *   - getAttribute - Get element attribute
 *   - getHtml     - Get outer HTML of element
 *
 * @module browser/commands
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Command Registry
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Registry of all available browser commands with their metadata.
 * Each command has: name, description, parameters schema, and handler.
 *
 * @type {Array<{ name: string, description: string, parameters: object, handler: Function }>}
 */
export const COMMAND_REGISTRY = [];

// ═══════════════════════════════════════════════════════════════════════════════
// Command Handlers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Takes a snapshot of the current page state.
 * Returns: URL, title, screenshot (base64), and page text content.
 *
 * @param {object} page - Playwright Page object
 * @param {object} params
 * @param {boolean} [params.fullPage=false] - Capture full page screenshot
 * @returns {Promise<object>}
 */
export async function snapshot(page, params = {}) {
  const { fullPage = false } = params;

  const [url, title, screenshot, textContent, html] = await Promise.all([
    page.url(),
    page.title(),
    page.screenshot({ type: "png", fullPage, timeout: 10000 }),
    page.evaluate(() => document.body?.innerText || ""),
    page.evaluate(() => document.documentElement?.outerHTML || ""),
  ]);

  return {
    url,
    title,
    screenshot: screenshot.toString("base64"),
    textContent: textContent.substring(0, 5000),
    htmlPreview: html.substring(0, 2000),
    timestamp: Date.now(),
  };
}

/**
 * Clicks an element matching the given selector.
 * Waits for the element to be visible before clicking.
 *
 * @param {object} page - Playwright Page object
 * @param {object} params
 * @param {string} params.selector - CSS selector to click
 * @param {object} [params.options] - Click options (button, clickCount, delay)
 * @returns {Promise<object>}
 */
export async function click(page, params = {}) {
  const { selector, options = {} } = params;

  if (!selector) {
    return { success: false, error: "selector is required" };
  }

  await page.waitForSelector(selector, { state: "visible", timeout: 5000 });
  await page.click(selector, options);

  // Take post-click snapshot
  const postSnapshot = await snapshot(page);

  return {
    success: true,
    selector,
    ...postSnapshot,
  };
}

/**
 * Types text into an input element.
 * Clears existing content first, then types the new text.
 *
 * @param {object} page - Playwright Page object
 * @param {object} params
 * @param {string} params.selector - CSS selector for the input
 * @param {string} params.text - Text to type
 * @param {object} [params.options] - Type options (delay)
 * @returns {Promise<object>}
 */
export async function type(page, params = {}) {
  const { selector, text, options = {} } = params;

  if (!selector) return { success: false, error: "selector is required" };
  if (text === undefined) return { success: false, error: "text is required" };

  await page.waitForSelector(selector, { state: "visible", timeout: 5000 });
  await page.click(selector);
  await page.fill(selector, ""); // Clear existing content
  await page.type(selector, String(text), { delay: options.delay || 10 });

  return {
    success: true,
    selector,
    typed: String(text).length,
  };
}

/**
 * Takes a full-page screenshot.
 *
 * @param {object} page - Playwright Page object
 * @param {object} params
 * @param {boolean} [params.fullPage=true] - Capture full page
 * @param {string} [params.selector] - Capture specific element
 * @returns {Promise<object>}
 */
export async function screenshot(page, params = {}) {
  const { fullPage = true, selector } = params;

  let buffer;
  if (selector) {
    const element = await page.waitForSelector(selector, { timeout: 5000 });
    buffer = await element.screenshot({ type: "png", timeout: 10000 });
  } else {
    buffer = await page.screenshot({ type: "png", fullPage, timeout: 10000 });
  }

  return {
    success: true,
    screenshot: buffer.toString("base64"),
    selector: selector || null,
    fullPage,
    timestamp: Date.now(),
  };
}

/**
 * Navigates to a URL.
 *
 * @param {object} page - Playwright Page object
 * @param {object} params
 * @param {string} params.url - URL to navigate to
 * @param {object} [params.options] - Navigation options (timeout, waitUntil)
 * @returns {Promise<object>}
 */
export async function navigate(page, params = {}) {
  const { url, options = {} } = params;

  if (!url) return { success: false, error: "url is required" };

  const response = await page.goto(url, {
    timeout: options.timeout || 30000,
    waitUntil: options.waitUntil || "networkidle",
  });

  const postSnapshot = await snapshot(page);

  return {
    success: true,
    url,
    status: response?.status() || null,
    ...postSnapshot,
  };
}

/**
 * Extracts text content from an element.
 *
 * @param {object} page - Playwright Page object
 * @param {object} params
 * @param {string} params.selector - CSS selector
 * @param {string} [params.property] - Property to extract (textContent, innerText, value, href, src)
 * @returns {Promise<object>}
 */
export async function extract(page, params = {}) {
  const { selector, property = "textContent" } = params;

  if (!selector) return { success: false, error: "selector is required" };

  const element = await page.waitForSelector(selector, { timeout: 5000 });
  const value = await element.evaluate((el, prop) => {
    if (prop === "textContent" || prop === "innerText") return el[prop];
    if (prop === "value") return el.value;
    return el.getAttribute(prop) || el[prop] || "";
  }, property);

  return {
    success: true,
    selector,
    property,
    value: String(value),
  };
}

/**
 * Scrolls the page.
 *
 * @param {object} page - Playwright Page object
 * @param {object} params
 * @param {number} [params.x=0] - Horizontal scroll position
 * @param {number} [params.y=0] - Vertical scroll position
 * @param {string} [params.direction] - "up", "down", "left", "right" (relative scroll)
 * @param {number} [params.amount=300] - Pixels for relative scroll
 * @returns {Promise<object>}
 */
export async function scroll(page, params = {}) {
  const { x = 0, y = 0, direction, amount = 300 } = params;

  if (direction) {
    const directions = { up: [0, -amount], down: [0, amount], left: [-amount, 0], right: [amount, 0] };
    const [dx, dy] = directions[direction] || [0, 0];
    await page.evaluate(([sx, sy]) => window.scrollBy(sx, sy), [dx, dy]);
  } else {
    await page.evaluate(([sx, sy]) => window.scrollTo(sx, sy), [x, y]);
  }

  return {
    success: true,
    scrollX: await page.evaluate(() => window.scrollX),
    scrollY: await page.evaluate(() => window.scrollY),
  };
}

/**
 * Waits for a condition.
 *
 * @param {object} page - Playwright Page object
 * @param {object} params
 * @param {string} [params.selector] - Wait for selector to appear
 * @param {number} [params.timeout=5000] - Max wait time in ms
 * @param {string} [params.state="visible"] - Selector state (visible, hidden, attached, detached)
 * @returns {Promise<object>}
 */
export async function wait(page, params = {}) {
  const { selector, timeout = 5000, state = "visible" } = params;

  if (selector) {
    await page.waitForSelector(selector, { state, timeout });
    return { success: true, selector, state, waited: true };
  }

  // If no selector, just wait for the timeout
  await new Promise((resolve) => setTimeout(resolve, Math.min(timeout, 3000)));
  return { success: true, waited: true, duration: Math.min(timeout, 3000) };
}

/**
 * Evaluates JavaScript in the page context.
 *
 * @param {object} page - Playwright Page object
 * @param {object} params
 * @param {string} params.script - JavaScript code to execute
 * @returns {Promise<object>}
 */
export async function evaluate(page, params = {}) {
  const { script } = params;

  if (!script) return { success: false, error: "script is required" };

  try {
    const result = await page.evaluate((code) => {
      try {
        return { success: true, result: eval(code) };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }, script);

    return {
      success: true,
      result: typeof result === "object" ? JSON.stringify(result, null, 2) : String(result),
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Gets or sets cookies.
 *
 * @param {object} page - Playwright Page object
 * @param {object} params
 * @param {string} [params.action="get"] - "get" or "set"
 * @param {Array} [params.cookies] - Cookies to set (for action="set")
 * @returns {Promise<object>}
 */
export async function cookies(page, params = {}) {
  const { action = "get", cookies: cookiesToSet } = params;

  if (action === "set") {
    if (!cookiesToSet || !Array.isArray(cookiesToSet)) {
      return { success: false, error: "cookies array is required for action='set'" };
    }
    await page.context().addCookies(cookiesToSet);
    return { success: true, action: "set", count: cookiesToSet.length };
  }

  const currentCookies = await page.context().cookies();
  return {
    success: true,
    action: "get",
    cookies: currentCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
    })),
    count: currentCookies.length,
  };
}

/**
 * Hovers over an element.
 *
 * @param {object} page - Playwright Page object
 * @param {object} params
 * @param {string} params.selector - CSS selector
 * @returns {Promise<object>}
 */
export async function hover(page, params = {}) {
  const { selector } = params;

  if (!selector) return { success: false, error: "selector is required" };

  await page.waitForSelector(selector, { state: "visible", timeout: 5000 });
  await page.hover(selector);

  return { success: true, selector };
}

/**
 * Selects an option in a dropdown.
 *
 * @param {object} page - Playwright Page object
 * @param {object} params
 * @param {string} params.selector - CSS selector for the select element
 * @param {string|string[]} params.value - Value(s) to select
 * @returns {Promise<object>}
 */
export async function select(page, params = {}) {
  const { selector, value } = params;

  if (!selector) return { success: false, error: "selector is required" };
  if (!value) return { success: false, error: "value is required" };

  await page.waitForSelector(selector, { state: "visible", timeout: 5000 });
  const values = Array.isArray(value) ? value : [value];
  await page.selectOption(selector, values);

  return { success: true, selector, selected: values };
}

/**
 * Uploads a file.
 *
 * @param {object} page - Playwright Page object
 * @param {object} params
 * @param {string} params.selector - CSS selector for the file input
 * @param {string|string[]} params.filePath - File path(s) to upload
 * @returns {Promise<object>}
 */
export async function upload(page, params = {}) {
  const { selector, filePath } = params;

  if (!selector) return { success: false, error: "selector is required" };
  if (!filePath) return { success: false, error: "filePath is required" };

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.click(selector);
  const fileChooser = await fileChooserPromise;
  const paths = Array.isArray(filePath) ? filePath : [filePath];
  await fileChooser.setFiles(paths);

  return { success: true, selector, files: paths };
}

/**
 * Presses a keyboard key.
 *
 * @param {object} page - Playwright Page object
 * @param {object} params
 * @param {string} params.key - Key to press (e.g., "Enter", "Escape", "Tab")
 * @param {string} [params.selector] - Focus element first
 * @returns {Promise<object>}
 */
export async function press(page, params = {}) {
  const { key, selector } = params;

  if (!key) return { success: false, error: "key is required" };

  if (selector) {
    await page.waitForSelector(selector, { state: "visible", timeout: 5000 });
    await page.click(selector);
  }

  await page.keyboard.press(key);

  return { success: true, key, selector: selector || null };
}

/**
 * Reloads the current page.
 *
 * @param {object} page - Playwright Page object
 * @param {object} params
 * @param {object} [params.options] - Reload options
 * @returns {Promise<object>}
 */
export async function reload(page, params = {}) {
  const { options = {} } = params;

  await page.reload({
    timeout: options.timeout || 30000,
    waitUntil: options.waitUntil || "networkidle",
  });

  const postSnapshot = await snapshot(page);

  return {
    success: true,
    ...postSnapshot,
  };
}

/**
 * Goes back in browser history.
 *
 * @param {object} page - Playwright Page object
 * @returns {Promise<object>}
 */
export async function back(page) {
  const response = await page.goBack({ waitUntil: "networkidle" });

  const postSnapshot = await snapshot(page);

  return {
    success: true,
    previousUrl: response?.url() || null,
    ...postSnapshot,
  };
}

/**
 * Gets an attribute of an element.
 *
 * @param {object} page - Playwright Page object
 * @param {object} params
 * @param {string} params.selector - CSS selector
 * @param {string} params.attribute - Attribute name
 * @returns {Promise<object>}
 */
export async function getAttribute(page, params = {}) {
  const { selector, attribute } = params;

  if (!selector) return { success: false, error: "selector is required" };
  if (!attribute) return { success: false, error: "attribute is required" };

  const element = await page.waitForSelector(selector, { timeout: 5000 });
  const value = await element.getAttribute(attribute);

  return {
    success: true,
    selector,
    attribute,
    value: value || null,
  };
}

/**
 * Gets the outer HTML of an element.
 *
 * @param {object} page - Playwright Page object
 * @param {object} params
 * @param {string} params.selector - CSS selector
 * @returns {Promise<object>}
 */
export async function getHtml(page, params = {}) {
  const { selector } = params;

  if (!selector) return { success: false, error: "selector is required" };

  const element = await page.waitForSelector(selector, { timeout: 5000 });
  const html = await element.evaluate((el) => el.outerHTML);

  return {
    success: true,
    selector,
    html,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Command Dispatcher
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Maps command names to their handler functions.
 */
const COMMAND_HANDLERS = {
  snapshot,
  click,
  type,
  screenshot,
  navigate,
  extract,
  scroll,
  wait,
  evaluate,
  cookies,
  hover,
  select,
  upload,
  press,
  reload,
  back,
  getAttribute,
  getHtml,
};

/**
 * Dispatches a browser command to the appropriate handler.
 *
 * @param {object} page - Playwright Page object
 * @param {string} command - Command name
 * @param {object} params - Command parameters
 * @returns {Promise<object>}
 */
export async function dispatchCommand(page, command, params = {}) {
  const handler = COMMAND_HANDLERS[command];
  if (!handler) {
    return {
      success: false,
      error: `Unknown command: "${command}". Available: ${Object.keys(COMMAND_HANDLERS).join(", ")}`,
    };
  }

  try {
    return await handler(page, params);
  } catch (err) {
    return {
      success: false,
      error: `Browser command "${command}" failed: ${err.message}`,
      command,
    };
  }
}

/**
 * Returns the list of available commands with descriptions.
 * @returns {Array<{ name: string, description: string, parameters: object }>}
 */
export function listCommands() {
  return Object.entries(COMMAND_HANDLERS).map(([name, handler]) => ({
    name,
    description: handler.description || `Browser command: ${name}`,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════════

export {
  COMMAND_HANDLERS,
};

export default {
  dispatchCommand,
  listCommands,
  COMMAND_HANDLERS,
};
