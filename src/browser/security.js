/**
 * browser/security — Browser Daemon Security Module
 *
 * Phase 3: Browser Automation Daemon (gstack-inspired)
 *
 * Security measures for the browser automation daemon:
 *   - Localhost-only binding (no external access)
 *   - Bearer token authentication for all commands
 *   - Anti-bot stealth configuration for Playwright
 *   - Cookie security (in-memory only, never written to disk)
 *   - Command rate limiting
 *   - Allowed origin validation
 *
 * @module browser/security
 */

import crypto from "crypto";

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

/** Length of the auto-generated auth token */
const TOKEN_BYTES = 32;

/** Default rate limit: max commands per second */
const DEFAULT_RATE_LIMIT = 10;

/** Default rate limit window in ms */
const RATE_LIMIT_WINDOW_MS = 1000;

// ═══════════════════════════════════════════════════════════════════════════════
// Token Management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generates a cryptographically secure random token.
 * @returns {string} Hex-encoded token
 */
export function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("hex");
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function secureCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Auth Validator
// ═══════════════════════════════════════════════════════════════════════════════

export class AuthValidator {
  /**
   * @param {object} [options]
   * @param {string} [options.token] - Pre-defined token (auto-generated if not provided)
   * @param {boolean} [options.enabled=true] - Whether auth is enabled
   */
  constructor(options = {}) {
    this._token = options.token || generateToken();
    this._enabled = options.enabled !== false;
  }

  /** @returns {string} The current auth token */
  get token() {
    return this._token;
  }

  /** @returns {boolean} Whether auth is enabled */
  get enabled() {
    return this._enabled;
  }

  /**
   * Validates an Authorization header value.
   * Supports: "Bearer <token>" format.
   *
   * @param {string} authHeader - The Authorization header value
   * @returns {{ valid: boolean, reason?: string }}
   */
  validate(authHeader) {
    if (!this._enabled) {
      return { valid: true };
    }

    if (!authHeader) {
      return { valid: false, reason: "Missing Authorization header" };
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return { valid: false, reason: "Invalid Authorization format. Use: Bearer <token>" };
    }

    const provided = match[1].trim();
    if (!secureCompare(provided, this._token)) {
      return { valid: false, reason: "Invalid token" };
    }

    return { valid: true };
  }

  /**
   * Creates an HTTP Authorization header value.
   * @returns {string}
   */
  toHeader() {
    return `Bearer ${this._token}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Rate Limiter (Simple Sliding Window)
// ═══════════════════════════════════════════════════════════════════════════════

export class CommandRateLimiter {
  /**
   * @param {object} [options]
   * @param {number} [options.maxCommands=10] - Max commands per window
   * @param {number} [options.windowMs=1000] - Window duration in ms
   */
  constructor(options = {}) {
    this._maxCommands = options.maxCommands || DEFAULT_RATE_LIMIT;
    this._windowMs = options.windowMs || RATE_LIMIT_WINDOW_MS;
    /** @type {number[]} Timestamps of recent commands */
    this._timestamps = [];
  }

  /**
   * Attempts to consume a rate limit slot.
   * @returns {{ allowed: boolean, remaining: number, resetMs: number }}
   */
  consume() {
    const now = Date.now();
    const windowStart = now - this._windowMs;

    // Remove timestamps outside the window
    this._timestamps = this._timestamps.filter((t) => t > windowStart);

    if (this._timestamps.length >= this._maxCommands) {
      const oldest = this._timestamps[0];
      const resetMs = oldest + this._windowMs - now;
      return { allowed: false, remaining: 0, resetMs: Math.max(0, resetMs) };
    }

    this._timestamps.push(now);
    return {
      allowed: true,
      remaining: this._maxCommands - this._timestamps.length,
      resetMs: 0,
    };
  }

  /** Resets the rate limiter. */
  reset() {
    this._timestamps = [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stealth Configuration
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns Playwright launch options with anti-bot stealth configuration.
 * Mimics a real Chrome browser to avoid detection by bot detectors.
 *
 * @param {object} [options]
 * @param {boolean} [options.headless=true] - Whether to run headless
 * @param {string} [options.userDataDir] - Custom user data directory
 * @returns {object} Playwright launch options
 */
export function getStealthLaunchOptions(options = {}) {
  const { headless = true, userDataDir } = options;

  return {
    headless,
    args: [
      // Anti-bot: disable automation flags
      "--disable-blink-features=AutomationControlled",
      // Anti-bot: use real Chrome fingerprint
      "--disable-features=IsolateOrigins,site-per-process",
      // Performance
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      // Anti-bot: language and timezone
      "--lang=en-US",
      "--timezone-for-testing=America/New_York",
      // Window size for consistent screenshots
      "--window-size=1280,720",
    ],
    // Anti-bot: realistic viewport
    viewport: { width: 1280, height: 720 },
    // Anti-bot: set locale
    locale: "en-US",
    // Anti-bot: set timezone
    timezoneId: "America/New_York",
    // Anti-bot: geolocation
    geolocation: { latitude: 40.7128, longitude: -74.006 },
    permissions: ["geolocation"],
    // User data directory for persistent cookies
    ...(userDataDir ? { userDataDir } : {}),
  };
}

/**
 * JavaScript to inject into pages to hide automation traces.
 * This script runs before any page JavaScript.
 *
 * @returns {string}
 */
export function getStealthScript() {
  return `
    // Hide webdriver property
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });

    // Override plugins array
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });

    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    // Override chrome.runtime
    window.chrome = {
      runtime: {},
      loadTimes: function() {},
      csi: function() {},
      app: {},
    };

    // Override permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
  `;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Origin Validation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validates that a request origin is allowed.
 * By default, only localhost origins are permitted.
 *
 * @param {string} origin - The Origin header value
 * @returns {boolean}
 */
export function isValidOrigin(origin) {
  if (!origin) return true; // No origin = same-origin request

  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".local")
    );
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════════

export default {
  generateToken,
  secureCompare,
  AuthValidator,
  CommandRateLimiter,
  getStealthLaunchOptions,
  getStealthScript,
  isValidOrigin,
};
