/**
 * rate_limiter — Token Bucket Rate Limiter
 *
 * v1.0 — June 2026
 *
 * Zero-dependency token bucket rate limiter using only Node.js built-ins.
 * Supports:
 *   - Named buckets with independent limits
 *   - Configurable refill rate and interval
 *   - Burst support up to maxTokens
 *   - Stats tracking (total, denied, peak usage)
 *   - Event emitter for 'rate_limited' events
 *   - Monotonically increasing clock (performance.now()) for timing
 *   - Async consume() for future distributed rate limiting
 */

import EventEmitter from "events";

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_OPTIONS = {
  maxTokens: 60,
  refillRate: 1,
  refillInterval: 1000,
  tokensPerRequest: 1,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RateLimiter
// ═══════════════════════════════════════════════════════════════════════════════

class RateLimiter extends EventEmitter {
  /**
   * @param {object} [options] - Default options for the global bucket
   * @param {number} [options.maxTokens=60] - Maximum tokens in the bucket
   * @param {number} [options.refillRate=1] - Tokens added per refillInterval
   * @param {number} [options.refillInterval=1000] - Milliseconds between refills
   * @param {number} [options.tokensPerRequest=1] - Tokens consumed per request
   */
  constructor(options = {}) {
    super();

    const opts = { ...DEFAULT_OPTIONS, ...options };

    /** @type {Map<string, object>} Internal bucket storage */
    this._buckets = new Map();

    /** @type {object} Default options applied to all buckets */
    this._defaults = {
      maxTokens: opts.maxTokens,
      refillRate: opts.refillRate,
      refillInterval: opts.refillInterval,
      tokensPerRequest: opts.tokensPerRequest,
    };

    // Create the default 'global' bucket
    this.createBucket("global", opts);
  }

  /**
   * Creates a named bucket with its own rate limit configuration.
   * If a bucket with the same name already exists, it is NOT overwritten.
   *
   * @param {string} name - Bucket name (e.g., 'api', 'mcp', 'search')
   * @param {object} [options] - Bucket-specific options (merged with defaults)
   * @param {number} [options.maxTokens] - Maximum tokens for this bucket
   * @param {number} [options.refillRate] - Tokens added per refillInterval
   * @param {number} [options.refillInterval] - Milliseconds between refills
   * @param {number} [options.tokensPerRequest] - Tokens consumed per request
   * @returns {boolean} - true if created, false if already exists
   */
  createBucket(name, options = {}) {
    if (this._buckets.has(name)) {
      return false;
    }

    const opts = { ...this._defaults, ...options };

    this._buckets.set(name, {
      name,
      maxTokens: opts.maxTokens,
      refillRate: opts.refillRate,
      refillInterval: opts.refillInterval,
      tokensPerRequest: opts.tokensPerRequest,
      current: opts.maxTokens, // Start full (allows initial burst)
      lastRefill: this._now(),
      total: 0,
      denied: 0,
      peak: 0,
    });

    return true;
  }

  /**
   * Returns a monotonically increasing timestamp in milliseconds.
   * Uses performance.now() which is monotonic (unlike Date.now()).
   *
   * @returns {number} - Monotonic timestamp in ms
   */
  _now() {
    return performance.now();
  }

  /**
   * Refills a bucket based on elapsed time since last refill.
   *
   * @param {object} bucket - The bucket to refill
   */
  _refill(bucket) {
    const now = this._now();
    const elapsed = now - bucket.lastRefill;

    if (elapsed < bucket.refillInterval) {
      return; // Not enough time has passed
    }

    // Calculate how many refill intervals have elapsed
    const intervals = Math.floor(elapsed / bucket.refillInterval);
    const tokensToAdd = intervals * bucket.refillRate;

    if (tokensToAdd > 0) {
      bucket.current = Math.min(bucket.maxTokens, bucket.current + tokensToAdd);
      // Only advance lastRefill by the consumed intervals to avoid drift
      bucket.lastRefill += intervals * bucket.refillInterval;
    }
  }

  /**
   * Consumes tokens from a named bucket.
   * Returns true if the request is allowed, false if rate limited.
   *
   * @param {string} [bucketName='global'] - Name of the bucket to consume from
   * @param {number} [tokens=1] - Number of tokens to consume
   * @returns {Promise<boolean>} - true if allowed, false if rate limited
   */
  async consume(bucketName = "global", tokens = 1) {
    const bucket = this._buckets.get(bucketName);
    if (!bucket) {
      // Unknown bucket — allow by default (fail open)
      return true;
    }

    // Refill the bucket first
    this._refill(bucket);

    const tokensNeeded = tokens || bucket.tokensPerRequest || 1;

    if (bucket.current < tokensNeeded) {
      // Rate limited — deny
      bucket.denied++;
      this.emit("rate_limited", {
        bucket: bucketName,
        current: bucket.current,
        requested: tokensNeeded,
        max: bucket.maxTokens,
        denied: bucket.denied,
        total: bucket.total,
      });
      return false;
    }

    // Allow — consume tokens
    bucket.current -= tokensNeeded;
    bucket.total++;

    // Track peak usage (how many tokens have been consumed at once)
    const consumed = bucket.maxTokens - bucket.current;
    if (consumed > bucket.peak) {
      bucket.peak = consumed;
    }

    return true;
  }

  /**
   * Returns the current state of a bucket, or all buckets if no name given.
   *
   * @param {string} [bucketName] - Optional bucket name
   * @returns {object|Array<object>} - Bucket stats
   */
  getStats(bucketName) {
    if (bucketName) {
      const bucket = this._buckets.get(bucketName);
      if (!bucket) {
        return null;
      }
      return {
        bucket: bucket.name,
        current: bucket.current,
        max: bucket.maxTokens,
        denied: bucket.denied,
        total: bucket.total,
        peak: bucket.peak,
        refillRate: bucket.refillRate,
        refillInterval: bucket.refillInterval,
      };
    }

    // Return all buckets
    const stats = [];
    for (const [, bucket] of this._buckets) {
      stats.push({
        bucket: bucket.name,
        current: bucket.current,
        max: bucket.maxTokens,
        denied: bucket.denied,
        total: bucket.total,
        peak: bucket.peak,
        refillRate: bucket.refillRate,
        refillInterval: bucket.refillInterval,
      });
    }
    return stats;
  }

  /**
   * Resets all buckets to their initial state (full tokens, zero stats).
   */
  reset() {
    for (const [, bucket] of this._buckets) {
      bucket.current = bucket.maxTokens;
      bucket.lastRefill = this._now();
      bucket.total = 0;
      bucket.denied = 0;
      bucket.peak = 0;
    }
  }

  /**
   * Resets a specific named bucket to its initial state.
   *
   * @param {string} bucketName - Name of the bucket to reset
   * @returns {boolean} - true if reset, false if bucket not found
   */
  resetBucket(bucketName) {
    const bucket = this._buckets.get(bucketName);
    if (!bucket) {
      return false;
    }

    bucket.current = bucket.maxTokens;
    bucket.lastRefill = this._now();
    bucket.total = 0;
    bucket.denied = 0;
    bucket.peak = 0;
    return true;
  }

  /**
   * Returns the number of buckets.
   * @returns {number}
   */
  get bucketCount() {
    return this._buckets.size;
  }
}

export { RateLimiter };
export default RateLimiter;
