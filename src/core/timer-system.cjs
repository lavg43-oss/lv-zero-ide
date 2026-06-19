/**
 * lv-zero — Unified Timer System (CJS)
 *
 * Centralized timeout/retry/backoff module based on Antigravity timer analysis.
 * Provides timeout presets, async wrappers, exponential backoff, health check polling,
 * debounce, and command execution timeout utilities.
 *
 * All functions wrapped in try/catch. If module fails to load, operations proceed
 * without timeouts (graceful degradation).
 *
 * Timeout Presets (derived from plans/antigravity-timer-analysis.md):
 *   COMMAND_DEFAULT   60s  — Gemini CLI timeout
 *   COMMAND_BUILD     5min — Build operations (code workflow default)
 *   COMMAND_DEPLOY    10min — Full deploy pipeline
 *   COMMAND_TEST      3min  — Test execution (other tasks default)
 *   COMMAND_SHORT     30s   — Git/short commands
 *   CODE_REVIEW_QUICK 2min  — Codex quick analysis (120s)
 *   CODE_REVIEW_DEEP  3min  — Codex deep inspection (180s)
 */

"use strict";

// ─── Timeout Presets (milliseconds) ───────────────────────────────────────────

const TIMEOUTS = Object.freeze({
  /** Default command timeout — 60s (Gemini CLI) */
  COMMAND_DEFAULT: 60_000,
  /** Build operations — 5min (code workflow default) */
  COMMAND_BUILD: 300_000,
  /** Full deploy pipeline — 10min */
  COMMAND_DEPLOY: 600_000,
  /** Test execution — 3min */
  COMMAND_TEST: 180_000,
  /** Short commands (git, ls, echo) — 30s */
  COMMAND_SHORT: 30_000,
  /** Code review quick analysis — 2min (120s) */
  CODE_REVIEW_QUICK: 120_000,
  /** Code review deep inspection — 3min (180s) */
  CODE_REVIEW_DEEP: 180_000,
  /** Health check default interval — 3s between polls */
  HEALTH_CHECK_INTERVAL: 3_000,
  /** Retry backoff base delay — 1s */
  RETRY_BASE_DELAY: 1_000,
  /** Maximum retry attempts — 3 */
  RETRY_MAX_ATTEMPTS: 3,
});

// ─── Preset Name Map (for getTimeout) ─────────────────────────────────────────

const PRESET_ALIASES = {
  default: "COMMAND_DEFAULT",
  build: "COMMAND_BUILD",
  deploy: "COMMAND_DEPLOY",
  test: "COMMAND_TEST",
  short: "COMMAND_SHORT",
  "code-review": "CODE_REVIEW_QUICK",
  "code-review-quick": "CODE_REVIEW_QUICK",
  "code-review-deep": "CODE_REVIEW_DEEP",
  review: "CODE_REVIEW_QUICK",
};

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Resolve a timeout preset name to its millisecond value.
 * @param {string} [preset="default"] - Preset name or alias
 * @returns {number} Timeout in milliseconds
 */
function getTimeout(preset) {
  try {
    if (typeof preset === "number" && preset > 0) return preset;
    const key = PRESET_ALIASES[preset] || preset;
    return TIMEOUTS[key] ?? TIMEOUTS.COMMAND_DEFAULT;
  } catch {
    return TIMEOUTS.COMMAND_DEFAULT;
  }
}

/**
 * Wrap an async function with a timeout.
 * If the function does not resolve within timeoutMs, the returned promise rejects.
 * The operation is NOT automatically killed — the caller must handle the rejection.
 *
 * @param {Function|Promise} fn - Async function or promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} [label="Operation"] - Label for timeout error message
 * @returns {Promise<any>} Result of fn, or rejects with TimeoutError
 */
function withTimeout(fn, timeoutMs, label = "Operation") {
  try {
    const promise = typeof fn === "function" ? fn() : fn;
    const effectiveTimeout = timeoutMs > 0 ? timeoutMs : TIMEOUTS.COMMAND_DEFAULT;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error(`[TIMEOUT] ${label} timed out after ${effectiveTimeout}ms`);
        err.code = "TIMEOUT";
        err.timeoutMs = effectiveTimeout;
        reject(err);
      }, effectiveTimeout);

      Promise.resolve(promise).then(
        (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  } catch (err) {
    return Promise.reject(err);
  }
}

/**
 * Retry an async function with exponential backoff.
 * Implements the Antigravity pattern: 1s → 2s → 4s (doubling), max 3 attempts.
 *
 * @param {Function} fn - Async function to retry (must return a promise)
 * @param {Object} [options]
 * @param {number} [options.maxAttempts=3] - Maximum retry attempts
 * @param {number} [options.baseDelay=1000] - Base delay in ms (doubles each retry)
 * @param {Function} [options.onRetry] - Callback on each retry attempt (receives { attempt, error })
 * @param {boolean} [options.retryOnReject=true] - Whether to retry on promise rejection
 * @returns {Promise<any>} Result of fn, or rejects after all retries exhausted
 */
async function retryWithBackoff(fn, options = {}) {
  const {
    maxAttempts = TIMEOUTS.RETRY_MAX_ATTEMPTS,
    baseDelay = TIMEOUTS.RETRY_BASE_DELAY,
    onRetry = null,
    retryOnReject = true,
  } = options;

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      return result;
    } catch (err) {
      lastError = err;
      if (!retryOnReject) throw err;
      if (attempt >= maxAttempts) break;

      const delay = baseDelay * Math.pow(2, attempt - 1);
      if (typeof onRetry === "function") {
        try { onRetry({ attempt, error: err, delay }); } catch { /* ignore */ }
      }
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  const finalErr = new Error(
    `[TIMEOUT] All ${maxAttempts} retry attempts exhausted: ${lastError?.message || "unknown error"}`
  );
  finalErr.code = "RETRY_EXHAUSTED";
  finalErr.originalError = lastError;
  throw finalErr;
}

/**
 * Health check polling — repeatedly invoke a check function until it returns true
 * or the timeout elapses.
 *
 * @param {Function} checkFn - Function that returns boolean (or promise resolving to boolean)
 * @param {Object} [options]
 * @param {number} [options.interval=3000] - Poll interval in ms
 * @param {number} [options.timeout=60000] - Total timeout in ms
 * @param {string} [options.label="Health check"] - Label for error message
 * @returns {Promise<boolean>} True if check passed, false if timed out
 */
async function healthCheck(checkFn, options = {}) {
  const {
    interval = TIMEOUTS.HEALTH_CHECK_INTERVAL,
    timeout = TIMEOUTS.COMMAND_DEFAULT,
    label = "Health check",
  } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const ok = await checkFn();
      if (ok) return true;
    } catch {
      // check failed, continue polling
    }
    await new Promise((r) => setTimeout(r, interval));
  }

  console.warn(`[TimerSystem] ${label} timed out after ${timeout}ms`);
  return false;
}

/**
 * Debounce — returns a function that delays invoking fn until after delayMs
 * have elapsed since the last invocation.
 *
 * @param {Function} fn - Function to debounce
 * @param {number} delayMs - Debounce delay in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(fn, delayMs = 3000) {
  let timer = null;
  let lastArgs = null;

  const debounced = function (...args) {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        fn.apply(this, lastArgs);
      } catch (err) {
        console.warn(`[TimerSystem] Debounced function error: ${err.message}`);
      }
    }, delayMs);
  };

  debounced.cancel = function () {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  debounced.flush = function () {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      try {
        fn.apply(this, lastArgs);
      } catch (err) {
        console.warn(`[TimerSystem] Debounced flush error: ${err.message}`);
      }
    }
  };

  return debounced;
}

/**
 * Poll until a condition is met or timeout elapses.
 *
 * @param {Function} conditionFn - Function that returns boolean (or promise)
 * @param {number} intervalMs - Poll interval in ms
 * @param {number} timeoutMs - Maximum time to poll in ms
 * @returns {Promise<boolean>} True if condition met, false if timed out
 */
async function pollUntil(conditionFn, intervalMs, timeoutMs) {
  const start = Date.now();
  const effectiveTimeout = timeoutMs > 0 ? timeoutMs : TIMEOUTS.COMMAND_DEFAULT;

  while (Date.now() - start < effectiveTimeout) {
    try {
      const met = await conditionFn();
      if (met) return true;
    } catch {
      // condition check failed, continue polling
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return false;
}

/**
 * Map a command string to a timeout preset name based on command type detection.
 *
 * @param {string} command - The command string to analyze
 * @returns {string} Timeout preset name
 */
function detectCommandType(command) {
  try {
    if (!command || typeof command !== "string") return "default";
    const cmd = command.trim().toLowerCase();

    // Build commands
    if (
      cmd.startsWith("npm run build") ||
      cmd.startsWith("npm run build:") ||
      cmd.startsWith("yarn build") ||
      cmd.startsWith("make") ||
      cmd.startsWith("cargo build") ||
      cmd.startsWith("docker build") ||
      cmd.startsWith("python setup.py build") ||
      cmd.includes("build")
    ) {
      return "build";
    }

    // Deploy commands
    if (
      cmd.startsWith("npm run deploy") ||
      cmd.startsWith("yarn deploy") ||
      cmd.startsWith("npm run release") ||
      cmd.includes("deploy") ||
      cmd.includes("release") ||
      cmd.startsWith("git push")
    ) {
      return "deploy";
    }

    // Test commands
    if (
      cmd.startsWith("npm test") ||
      cmd.startsWith("npm run test") ||
      cmd.startsWith("yarn test") ||
      cmd.startsWith("npx jest") ||
      cmd.startsWith("npx mocha") ||
      cmd.startsWith("npx vitest") ||
      cmd.startsWith("python -m pytest") ||
      cmd.includes("test")
    ) {
      return "test";
    }

    // Install commands
    if (
      cmd.startsWith("npm install") ||
      cmd.startsWith("npm ci") ||
      cmd.startsWith("yarn install") ||
      cmd.startsWith("pip install") ||
      cmd.startsWith("cargo install") ||
      cmd.startsWith("go install") ||
      cmd.startsWith("gem install")
    ) {
      return "test"; // installs can take a while, use test timeout
    }

    // Short commands
    if (
      cmd.startsWith("git ") ||
      cmd.startsWith("ls") ||
      cmd.startsWith("dir") ||
      cmd.startsWith("echo") ||
      cmd.startsWith("cd ") ||
      cmd.startsWith("pwd") ||
      cmd.startsWith("node -c") ||
      cmd.startsWith("node --check") ||
      cmd.startsWith("type ") ||
      cmd.startsWith("cat ") ||
      cmd.startsWith("npm --version") ||
      cmd.startsWith("node --version") ||
      cmd.startsWith("node -v") ||
      cmd.startsWith("npm -v") ||
      cmd.length < 20
    ) {
      return "short";
    }

    return "default";
  } catch {
    return "default";
  }
}

/**
 * Get the appropriate timeout for a command string.
 * Combines detectCommandType + getTimeout.
 *
 * @param {string} command - Command string
 * @returns {number} Timeout in milliseconds
 */
function getCommandTimeout(command) {
  try {
    const type = detectCommandType(command);
    return getTimeout(type);
  } catch {
    return TIMEOUTS.COMMAND_DEFAULT;
  }
}

/**
 * Execute a function with a timeout determined by command type detection.
 * Convenience wrapper combining detectCommandType + withTimeout.
 *
 * @param {Function|Promise} fn - Async function or promise
 * @param {string} command - Command string for type detection
 * @returns {Promise<any>} Result of fn
 */
function executeWithTimeout(fn, command) {
  const timeoutMs = getCommandTimeout(command);
  return withTimeout(fn, timeoutMs, command);
}

/**
 * Get the full TIMEOUTS object (frozen, read-only).
 * @returns {Object}
 */
function getPresets() {
  return TIMEOUTS;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  TIMEOUTS,
  getTimeout,
  withTimeout,
  retryWithBackoff,
  healthCheck,
  debounce,
  pollUntil,
  detectCommandType,
  getCommandTimeout,
  executeWithTimeout,
  getPresets,
};
