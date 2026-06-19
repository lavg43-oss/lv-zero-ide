/**
 * browser/daemon — Long-Lived Chromium Process Manager
 *
 * Phase 3: Browser Automation Daemon (gstack-inspired)
 *
 * Manages a long-lived Chromium browser instance using Playwright.
 * Features:
 *   - Persistent browser context (cookies, tabs, login sessions)
 *   - 30-minute idle timeout with auto-shutdown
 *   - Health check with auto-restart
 *   - Sub-second command execution after first call (~100ms)
 *   - Multiple tab management
 *   - Screenshot and snapshot capabilities
 *
 * gstack inspiration:
 *   Long-lived Chromium daemon over localhost HTTP.
 *   First call ~3s (browser launch), subsequent calls ~100-200ms.
 *   Persistent state (cookies, tabs, login sessions) across commands.
 *
 * @module browser/daemon
 */

import { chromium } from "playwright";
import { EventEmitter } from "events";
import { AuthValidator, CommandRateLimiter, getStealthLaunchOptions, getStealthScript } from "./security.js";
import { dispatchCommand, listCommands } from "./commands.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

/** Default idle timeout in ms (30 minutes) */
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Health check interval in ms */
const HEALTH_CHECK_INTERVAL_MS = 15000;

/** Max consecutive health check failures before restart */
const MAX_HEALTH_FAILURES = 3;

/** Default navigation timeout in ms */
const DEFAULT_NAV_TIMEOUT_MS = 30000;

// ═══════════════════════════════════════════════════════════════════════════════
// Browser Daemon
// ═══════════════════════════════════════════════════════════════════════════════

export class BrowserDaemon extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.idleTimeoutMs=1800000] - Idle timeout (30 min default)
   * @param {boolean} [options.headless=true] - Run headless
   * @param {string} [options.userDataDir] - Custom user data directory
   * @param {boolean} [options.auth=true] - Enable token auth
   * @param {string} [options.token] - Pre-defined auth token
   * @param {number} [options.rateLimit=10] - Max commands per second
   */
  constructor(options = {}) {
    super();

    this._idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this._headless = options.headless !== false;
    this._userDataDir = options.userDataDir || null;

    // Security
    this._auth = new AuthValidator({
      token: options.token,
      enabled: options.auth !== false,
    });
    this._rateLimiter = new CommandRateLimiter({
      maxCommands: options.rateLimit || 10,
    });

    // Browser state
    /** @type {import('playwright').Browser|null} */
    this._browser = null;
    /** @type {import('playwright').BrowserContext|null} */
    this._context = null;
    /** @type {import('playwright').Page|null} */
    this._page = null;

    /** @type {"stopped"|"starting"|"running"|"stopping"|"error"} */
    this._state = "stopped";
    this._lastActivity = 0;
    this._healthFailures = 0;
    this._idleTimer = null;
    this._healthTimer = null;
    this._launchTime = null;
    this._commandCount = 0;
  }

  // ─── Properties ─────────────────────────────────────────────────────────

  /** @returns {string} Current daemon state */
  get state() {
    return this._state;
  }

  /** @returns {boolean} Whether the browser is running */
  get isRunning() {
    return this._state === "running" && this._browser !== null;
  }

  /** @returns {string} The auth token */
  get token() {
    return this._auth.token;
  }

  /** @returns {import('playwright').Page|null} The active page */
  get page() {
    return this._page;
  }

  /** @returns {number} Commands executed since launch */
  get commandCount() {
    return this._commandCount;
  }

  /** @returns {number|null} Uptime in seconds, or null if not running */
  get uptime() {
    if (!this._launchTime) return null;
    return Math.floor((Date.now() - this._launchTime) / 1000);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Starts the browser daemon.
   * Launches Chromium with stealth configuration.
   *
   * @returns {Promise<{ success: boolean, token?: string, error?: string }>}
   */
  async start() {
    if (this._state === "running") {
      return { success: true, token: this._auth.token };
    }

    this._state = "starting";
    this.emit("starting");

    try {
      const launchOptions = getStealthLaunchOptions({
        headless: this._headless,
        userDataDir: this._userDataDir,
      });

      this._browser = await chromium.launch(launchOptions);
      this._context = await this._browser.newContext({
        viewport: { width: 1280, height: 720 },
        locale: "en-US",
        timezoneId: "America/New_York",
      });

      // Create initial blank page
      this._page = await this._context.newPage();

      // Inject stealth script
      await this._context.addInitScript(getStealthScript());

      // Set default timeout
      this._page.setDefaultTimeout(DEFAULT_NAV_TIMEOUT_MS);

      // Handle browser disconnection
      this._browser.on("disconnected", () => {
        this.emit("disconnected");
        if (this._state === "running") {
          this._state = "error";
          this._handleCrash();
        }
      });

      this._state = "running";
      this._launchTime = Date.now();
      this._lastActivity = Date.now();
      this._commandCount = 0;
      this._healthFailures = 0;

      // Start health checks
      this._startHealthChecks();

      // Start idle timer
      this._resetIdleTimer();

      this.emit("started", { token: this._auth.token });
      this.emit("log", `   🌐 Browser daemon iniciado (headless: ${this._headless})`);

      return {
        success: true,
        token: this._auth.token,
      };
    } catch (err) {
      this._state = "error";
      this.emit("error", { phase: "start", error: err.message });
      this.emit("log", `   ⚠️ Browser daemon: error al iniciar: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Stops the browser daemon gracefully.
   */
  async stop() {
    if (this._state === "stopped") return;

    this._state = "stopping";
    this.emit("stopping");

    // Clear timers
    this._clearTimers();

    try {
      if (this._page) {
        await this._page.close().catch(() => {});
        this._page = null;
      }
      if (this._context) {
        await this._context.close().catch(() => {});
        this._context = null;
      }
      if (this._browser) {
        await this._browser.close().catch(() => {});
        this._browser = null;
      }
    } catch (err) {
      this.emit("log", `   ⚠️ Browser daemon: error al detener: ${err.message}`);
    }

    this._state = "stopped";
    this._launchTime = null;
    this._commandCount = 0;

    this.emit("stopped");
    this.emit("log", "   🌐 Browser daemon detenido");
  }

  /**
   * Restarts the browser daemon.
   */
  async restart() {
    this.emit("log", "   🔄 Browser daemon: reiniciando...");
    await this.stop();
    return await this.start();
  }

  // ─── Command Execution ─────────────────────────────────────────────────

  /**
   * Executes a browser command.
   *
   * @param {string} command - Command name (e.g., "navigate", "click", "snapshot")
   * @param {object} [params={}] - Command parameters
   * @param {string} [authToken] - Auth token for validation
   * @returns {Promise<object>}
   */
  async execute(command, params = {}, authToken) {
    // Auth check
    if (authToken) {
      const authResult = this._auth.validate(`Bearer ${authToken}`);
      if (!authResult.valid) {
        return { success: false, error: `Auth error: ${authResult.reason}` };
      }
    }

    // Rate limit check
    const rateResult = this._rateLimiter.consume();
    if (!rateResult.allowed) {
      return {
        success: false,
        error: `Rate limited. Retry in ${rateResult.resetMs}ms`,
        retryAfterMs: rateResult.resetMs,
      };
    }

    // Ensure browser is running
    if (!this.isRunning || !this._page) {
      const startResult = await this.start();
      if (!startResult.success) {
        return { success: false, error: `Browser not available: ${startResult.error}` };
      }
    }

    // Reset idle timer on activity
    this._lastActivity = Date.now();
    this._resetIdleTimer();

    // Execute command
    this._commandCount++;
    this.emit("command", { command, params, count: this._commandCount });

    const result = await dispatchCommand(this._page, command, params);

    this.emit("command_result", { command, success: result.success, duration: Date.now() - this._lastActivity });

    return result;
  }

  /**
   * Gets the current status of the daemon.
   * @returns {object}
   */
  getStatus() {
    return {
      state: this._state,
      running: this.isRunning,
      uptime: this.uptime,
      commandCount: this._commandCount,
      lastActivity: this._lastActivity ? new Date(this._lastActivity).toISOString() : null,
      idleTimeoutMs: this._idleTimeoutMs,
      headless: this._headless,
      authEnabled: this._auth.enabled,
      pageUrl: this._page ? this._page.url() : null,
      pageTitle: this._page ? this._page.title() : null,
      availableCommands: listCommands().map((c) => c.name),
    };
  }

  // ─── Tab Management ────────────────────────────────────────────────────

  /**
   * Creates a new tab and switches to it.
   * @param {string} [url] - Optional URL to navigate to
   * @returns {Promise<{ success: boolean, tabCount: number }>}
   */
  async newTab(url) {
    if (!this._context) {
      return { success: false, error: "Browser not running" };
    }

    const page = await this._context.newPage();
    this._page = page;

    if (url) {
      await page.goto(url, { waitUntil: "networkidle", timeout: DEFAULT_NAV_TIMEOUT_MS });
    }

    const pages = this._context.pages();
    return { success: true, tabCount: pages.length, currentUrl: page.url() };
  }

  /**
   * Switches to a specific tab by index.
   * @param {number} index - Tab index (0-based)
   * @returns {Promise<{ success: boolean, tabCount: number }>}
   */
  async switchTab(index) {
    if (!this._context) {
      return { success: false, error: "Browser not running" };
    }

    const pages = this._context.pages();
    if (index < 0 || index >= pages.length) {
      return { success: false, error: `Tab index ${index} out of range (0-${pages.length - 1})` };
    }

    this._page = pages[index];
    await this._page.bringToFront();

    return { success: true, tabCount: pages.length, currentUrl: this._page.url() };
  }

  /**
   * Lists all open tabs.
   * @returns {Array<{ index: number, url: string, title: string }>}
   */
  listTabs() {
    if (!this._context) return [];

    return this._context.pages().map((page, index) => ({
      index,
      url: page.url(),
      title: page.title(),
      active: page === this._page,
    }));
  }

  /**
   * Closes a specific tab by index.
   * @param {number} index - Tab index to close
   * @returns {Promise<{ success: boolean, tabCount: number }>}
   */
  async closeTab(index) {
    if (!this._context) {
      return { success: false, error: "Browser not running" };
    }

    const pages = this._context.pages();
    if (index < 0 || index >= pages.length) {
      return { success: false, error: `Tab index ${index} out of range` };
    }

    const page = pages[index];
    await page.close();

    // If we closed the active page, switch to another
    if (page === this._page) {
      const remaining = this._context.pages();
      this._page = remaining.length > 0 ? remaining[0] : await this._context.newPage();
    }

    return { success: true, tabCount: this._context.pages().length };
  }

  // ─── Health Checks ─────────────────────────────────────────────────────

  _startHealthChecks() {
    this._clearHealthTimer();
    this._healthTimer = setInterval(() => this._performHealthCheck(), HEALTH_CHECK_INTERVAL_MS);
  }

  _clearHealthTimer() {
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
  }

  async _performHealthCheck() {
    if (this._state !== "running") return;

    try {
      if (!this._browser || !this._browser.isConnected()) {
        throw new Error("Browser disconnected");
      }

      // Quick ping via pages count
      if (this._context) {
        this._context.pages();
      }

      // Reset failures on success
      this._healthFailures = 0;
    } catch (err) {
      this._healthFailures++;
      this.emit("log", `   ⚠️ Browser health check fallido (${this._healthFailures}/${MAX_HEALTH_FAILURES}): ${err.message}`);

      if (this._healthFailures >= MAX_HEALTH_FAILURES) {
        this.emit("log", "   🔄 Browser daemon: salud crítico, reiniciando...");
        this._handleCrash();
      }
    }
  }

  async _handleCrash() {
    this.emit("crash");
    try {
      await this.restart();
    } catch (err) {
      this.emit("log", `   ❌ Browser daemon: no se pudo reiniciar: ${err.message}`);
      this._state = "error";
    }
  }

  // ─── Idle Timeout ──────────────────────────────────────────────────────

  _resetIdleTimer() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
    }

    this._idleTimer = setTimeout(() => {
      const idleTime = Date.now() - this._lastActivity;
      if (idleTime >= this._idleTimeoutMs && this._state === "running") {
        this.emit("log", `   ⏰ Browser daemon: inactivo por ${Math.round(idleTime / 1000)}s, deteniendo...`);
        this.stop().catch(() => {});
      }
    }, this._idleTimeoutMs);
  }

  _clearTimers() {
    this._clearHealthTimer();
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════════

export default BrowserDaemon;
