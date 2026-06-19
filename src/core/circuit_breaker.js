/**
 * ⚡ Circuit Breaker — Resilient Provider Wrapper
 *
 * Prevents cascading failures and API noise by tracking consecutive
 * errors to the LLM provider. After FAILURE_THRESHOLD consecutive
 * failures, the circuit "opens" and all subsequent requests fail
 * immediately (fast-fail) without hitting the real provider.
 *
 * State Machine:
 *   CLOSED ──(failure >= threshold)──► OPEN ──(timeout)──► HALF_OPEN
 *   HALF_OPEN ──(success)──► CLOSED
 *   HALF_OPEN ──(failure)──► OPEN
 *
 * Usage:
 *   import { CircuitBreaker } from "./circuit_breaker.js";
 *   const breaker = new CircuitBreaker(provider, {
 *     failureThreshold: 3,
 *     openTimeoutMs: 30_000,
 *   });
 *   const stream = breaker.stream(messages, options);
 *   const response = await breaker.complete(messages, options);
 *
 *   breaker.getState(); // "CLOSED" | "OPEN" | "HALF_OPEN"
 *   breaker.getStats(); // { state, failureCount, ... }
 */

// ─── States ──────────────────────────────────────────────────────────────────

const STATE = {
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN",
};

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS = {
  /** Consecutive failures before opening the circuit */
  failureThreshold: 5,
  /** Milliseconds to wait before transitioning from OPEN → HALF_OPEN */
  openTimeoutMs: 60_000,
};

// ═══════════════════════════════════════════════════════════════════════════════
// CircuitBreaker
// ═══════════════════════════════════════════════════════════════════════════════

export class CircuitBreaker {
  /**
   * @param {object} provider - The real/mock provider to wrap
   * @param {object} [options]
   * @param {number} [options.failureThreshold=3]
   * @param {number} [options.openTimeoutMs=30_000]
   */
  constructor(provider, options = {}) {
    if (!provider) {
      throw new Error("CircuitBreaker requires a provider instance");
    }

    /** @type {object} The wrapped provider */
    this._provider = provider;

    const opts = { ...DEFAULT_OPTIONS, ...options };
    /** @type {number} Consecutive failures before opening */
    this._failureThreshold = opts.failureThreshold;
    /** @type {number} Milliseconds before attempting half-open */
    this._openTimeoutMs = opts.openTimeoutMs;

    /** @type {string} Current circuit state */
    this._state = STATE.CLOSED;
    /** @type {number} Consecutive failure count */
    this._failureCount = 0;
    /** @type {number|null} Timestamp when the circuit was opened */
    this._openedAt = null;
    /** @type {number} Total failures since creation */
    this._totalFailures = 0;
    /** @type {number} Total successes since creation */
    this._totalSuccesses = 0;
    /** @type {number} Number of fast-fail rejections (while OPEN) */
    this._rejectedCount = 0;
    /** @type {Array<string>} Recent error messages (last 5) */
    this._recentErrors = [];
  }

  // ─── Provider Delegation ─────────────────────────────────────────────────

  get name() { return this._provider.name; }
  get model() { return this._provider.model; }
  get label() { return this._provider.label; }

  /**
   * Returns the underlying wrapped provider instance.
   * Provides public access without exposing the private `_provider` property.
   * @returns {object}
   */
  getWrappedProvider() {
    return this._provider;
  }

  /**
   * Delegates isReady() to the wrapped provider.
   * @returns {boolean}
   */
  isReady() {
    return this._provider.isReady();
  }

  /**
   * Get model name from the wrapped provider.
   * @returns {string|null}
   */
  getModel() {
    return this._provider.getModel?.() ?? null;
  }

  /**
   * Non-streaming completion with circuit breaker protection.
   *
   * @param {Array<object>} messages
   * @param {object} [options]
   * @returns {Promise<object>}
   * @throws {Error} If circuit is OPEN
   */
  async complete(messages, options = {}) {
    this._checkState();

    try {
      const result = await this._provider.complete(messages, options);
      this._onSuccess();
      return result;
    } catch (err) {
      // Don't count user-initiated aborts as API failures
      if (err.name === 'AbortError' || err.message?.includes('abort') || err.message?.includes('🛑')) {
        // User stopped — don't count as circuit failure
        throw err;  // Re-throw without calling _onFailure
      }
      this._onFailure(err);
      throw err;
    }
  }

  /**
   * Streaming completion with circuit breaker protection.
   *
   * @param {Array<object>} messages
   * @param {object} [options]
   * @returns {AsyncGenerator<object>}
   * @throws {Error} If circuit is OPEN
   */
  async *stream(messages, options = {}) {
    this._checkState();

    const iterator = this._provider.stream(messages, options);

    try {
      let firstChunk = true;
      for await (const chunk of iterator) {
        if (firstChunk) {
          // First chunk received — provider is responsive
          this._onSuccess();
          firstChunk = false;
        }
        yield chunk;
      }
    } catch (err) {
      // Don't count user-initiated aborts as API failures
      if (err.name === 'AbortError' || err.message?.includes('abort') || err.message?.includes('🛑')) {
        // User stopped — don't count as circuit failure
        throw err;  // Re-throw without calling _onFailure
      }
      this._onFailure(err);
      throw err;
    }
  }

  // ─── State Query ─────────────────────────────────────────────────────────

  /**
   * Get current circuit state.
   * @returns {string} "CLOSED" | "OPEN" | "HALF_OPEN"
   */
  getState() {
    // Lazily transition OPEN → HALF_OPEN when timeout has elapsed
    if (this._state === STATE.OPEN && this._openedAt !== null) {
      const elapsed = Date.now() - this._openedAt;
      if (elapsed >= this._openTimeoutMs) {
        this._state = STATE.HALF_OPEN;
        this.emit?.("circuit_half_open", {
          elapsed,
          failureCount: this._failureCount,
        });
      }
    }
    return this._state;
  }

  /**
   * Check if the circuit is allowing requests through.
   * @returns {boolean}
   */
  isAllowed() {
    return this.getState() !== STATE.OPEN;
  }

  /**
   * Get detailed stats about the circuit breaker.
   * @returns {object}
   */
  getStats() {
    return {
      state: this.getState(),
      failureCount: this._failureCount,
      totalFailures: this._totalFailures,
      totalSuccesses: this._totalSuccesses,
      rejectedCount: this._rejectedCount,
      recentErrors: [...this._recentErrors],
      failureThreshold: this._failureThreshold,
      openTimeoutMs: this._openTimeoutMs,
      openedAt: this._openedAt,
      elapsedSinceOpen: this._openedAt ? Date.now() - this._openedAt : 0,
    };
  }

  /**
   * Manually reset the circuit to CLOSED state.
   * Useful after a configuration change or manual recovery.
   */
  reset() {
    this._state = STATE.CLOSED;
    this._failureCount = 0;
    this._openedAt = null;
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  /**
   * Check if the circuit allows a request through.
   * @throws {Error} If circuit is OPEN
   */
  _checkState() {
    const state = this.getState(); // triggers lazy HALF_OPEN transition

    if (state === STATE.OPEN) {
      this._rejectedCount++;
      const msg = `🔴 Circuito ABIERTO: ${this._failureCount} fallos consecutivos. ` +
                  `Reintentando en ${Math.max(0, Math.ceil((this._openTimeoutMs - (Date.now() - this._openedAt)) / 1000))}s.`;
      throw new Error(msg);
    }
  }

  /**
   * Handle a successful request.
   */
  _onSuccess() {
    this._totalSuccesses++;

    if (this._state === STATE.HALF_OPEN) {
      // Success in HALF_OPEN → back to CLOSED
      this._state = STATE.CLOSED;
      this._failureCount = 0;
      this._openedAt = null;
      this.emit?.("circuit_closed", { reason: "half_open_success" });
    } else {
      // Normal success — keep failure count low
      this._failureCount = 0;
    }
  }

  /**
   * Handle a failed request.
   * @param {Error} err
   */
  _onFailure(err) {
    this._totalFailures++;
    this._failureCount++;
    const errMsg = err?.message || String(err);

    // Keep last 5 errors
    this._recentErrors.push(errMsg);
    if (this._recentErrors.length > 5) {
      this._recentErrors.shift();
    }

    if (this._state === STATE.HALF_OPEN) {
      // Failure in HALF_OPEN → back to OPEN (reset the timer)
      this._state = STATE.OPEN;
      this._openedAt = Date.now();
      this.emit?.("circuit_open", {
        reason: "half_open_failure",
        failureCount: this._failureCount,
        error: errMsg,
      });
    } else if (this._state === STATE.CLOSED && this._failureCount >= this._failureThreshold) {
      // Threshold crossed → OPEN
      this._state = STATE.OPEN;
      this._openedAt = Date.now();
      this.emit?.("circuit_open", {
        reason: "threshold_exceeded",
        failureCount: this._failureCount,
        error: errMsg,
      });
    }
  }

  /**
   * Optional: Allow attaching an event emitter for circuit state changes.
   * @param {function} emitFn - Function to call with (eventName, data)
   */
  setEmitter(emitFn) {
    this.emit = emitFn;
  }
}

export default CircuitBreaker;
