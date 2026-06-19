/**
 * Unit tests for RateLimiter
 *
 * Tests the token bucket rate limiter: consume/refill, rate limiting,
 * multiple named buckets, stats tracking, and reset functionality.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RateLimiter } from "../../src/rate_limiter.js";

describe("RateLimiter", () => {
  let limiter;
  let mockTime = 0;

  beforeEach(() => {
    mockTime = 0;
    // Mock performance.now to return controllable time
    vi.spyOn(performance, "now").mockImplementation(() => mockTime);

    // Create a limiter with small limits for predictable testing
    limiter = new RateLimiter({
      maxTokens: 5,
      refillRate: 1,
      refillInterval: 100, // 100ms refill interval
      tokensPerRequest: 1,
    });
  });

  afterEach(() => {
    limiter.removeAllListeners();
    vi.restoreAllMocks();
  });

  // ─── Basic consume/refill ──────────────────────────────────────────────

  it("should allow consuming tokens up to the max", async () => {
    for (let i = 0; i < 5; i++) {
      const allowed = await limiter.consume("global", 1);
      expect(allowed).toBe(true);
    }
  });

  it("should start with maxTokens available", async () => {
    const stats = limiter.getStats("global");
    expect(stats.current).toBe(5);
    expect(stats.max).toBe(5);
  });

  it("should refill tokens over time", async () => {
    // Consume all tokens
    for (let i = 0; i < 5; i++) {
      await limiter.consume("global", 1);
    }

    // Should be denied now
    const denied = await limiter.consume("global", 1);
    expect(denied).toBe(false);

    // Advance time by 150ms (past the 100ms refill interval)
    mockTime += 150;

    // Should have 1 token back
    const allowed = await limiter.consume("global", 1);
    expect(allowed).toBe(true);
  });

  it("should not exceed maxTokens after multiple refills", async () => {
    // Consume all tokens
    for (let i = 0; i < 5; i++) {
      await limiter.consume("global", 1);
    }

    // Advance time by 500ms (5 refill intervals)
    mockTime += 500;

    // Trigger a consume to force refill (getStats doesn't refill)
    // After refill: current = min(5, 0 + 5) = 5
    // After consume(1): current = 4
    const allowed = await limiter.consume("global", 1);
    expect(allowed).toBe(true);

    // Should have been capped at maxTokens (5) before consuming 1
    const stats = limiter.getStats("global");
    expect(stats.current).toBe(4); // 5 - 1 (consumed)
  });

  it("should consume multiple tokens per request", async () => {
    const multiLimiter = new RateLimiter({
      maxTokens: 10,
      refillRate: 5,
      refillInterval: 1000,
      tokensPerRequest: 3,
    });

    // First request consumes 3 tokens (10 → 7)
    const r1 = await multiLimiter.consume("global", 3);
    expect(r1).toBe(true);

    // Second request consumes 3 tokens (7 → 4)
    const r2 = await multiLimiter.consume("global", 3);
    expect(r2).toBe(true);

    // Third request consumes 3 tokens (4 >= 3, so allowed: 4 → 1)
    const r3 = await multiLimiter.consume("global", 3);
    expect(r3).toBe(true);

    // Fourth request: only 1 left, needs 3 → denied
    const r4 = await multiLimiter.consume("global", 3);
    expect(r4).toBe(false);
  });

  // ─── Rate limiting ─────────────────────────────────────────────────────

  it("should deny requests when tokens are exhausted", async () => {
    // Consume all 5 tokens
    for (let i = 0; i < 5; i++) {
      await limiter.consume("global", 1);
    }

    // 6th request should be denied
    const result = await limiter.consume("global", 1);
    expect(result).toBe(false);
  });

  it("should deny requests that require more tokens than available", async () => {
    // Consume 3 tokens
    await limiter.consume("global", 3);

    // Try to consume 3 more (only 2 left)
    const result = await limiter.consume("global", 3);
    expect(result).toBe(false);
  });

  it("should allow requests from unknown buckets (fail open)", async () => {
    const result = await limiter.consume("nonexistent-bucket", 1);
    expect(result).toBe(true);
  });

  // ─── Multiple named buckets ────────────────────────────────────────────

  it("should create and use named buckets", async () => {
    const created = limiter.createBucket("api", {
      maxTokens: 3,
      refillRate: 1,
      refillInterval: 1000,
    });
    expect(created).toBe(true);

    // Consume from named bucket
    for (let i = 0; i < 3; i++) {
      const allowed = await limiter.consume("api", 1);
      expect(allowed).toBe(true);
    }

    // 4th should be denied
    const denied = await limiter.consume("api", 1);
    expect(denied).toBe(false);
  });

  it("should not overwrite existing buckets", async () => {
    const first = limiter.createBucket("custom", { maxTokens: 10 });
    expect(first).toBe(true);

    const second = limiter.createBucket("custom", { maxTokens: 100 });
    expect(second).toBe(false);

    // Should still have the original config
    const stats = limiter.getStats("custom");
    expect(stats.max).toBe(10);
  });

  it("should maintain independent token counts per bucket", async () => {
    limiter.createBucket("bucket-a", { maxTokens: 2 });
    limiter.createBucket("bucket-b", { maxTokens: 5 });

    // Exhaust bucket-a
    await limiter.consume("bucket-a", 2);
    expect(await limiter.consume("bucket-a", 1)).toBe(false);

    // bucket-b should still have tokens
    expect(await limiter.consume("bucket-b", 1)).toBe(true);
    expect(await limiter.consume("bucket-b", 1)).toBe(true);
  });

  it("should report correct bucket count", () => {
    expect(limiter.bucketCount).toBe(1); // 'global' created by default

    limiter.createBucket("api");
    expect(limiter.bucketCount).toBe(2);

    limiter.createBucket("search");
    expect(limiter.bucketCount).toBe(3);
  });

  // ─── Stats tracking ────────────────────────────────────────────────────

  it("should track total requests", async () => {
    await limiter.consume("global", 1);
    await limiter.consume("global", 1);
    await limiter.consume("global", 1);

    const stats = limiter.getStats("global");
    expect(stats.total).toBe(3);
  });

  it("should track denied requests", async () => {
    // Exhaust tokens
    for (let i = 0; i < 5; i++) {
      await limiter.consume("global", 1);
    }

    // Get denied
    await limiter.consume("global", 1);
    await limiter.consume("global", 1);

    const stats = limiter.getStats("global");
    expect(stats.denied).toBe(2);
  });

  it("should track peak usage", async () => {
    await limiter.consume("global", 3);
    const stats = limiter.getStats("global");
    expect(stats.peak).toBe(3);
  });

  it("should return stats for all buckets when no name given", () => {
    limiter.createBucket("api", { maxTokens: 10 });
    limiter.createBucket("search", { maxTokens: 20 });

    const allStats = limiter.getStats();
    expect(Array.isArray(allStats)).toBe(true);
    expect(allStats.length).toBe(3);

    const names = allStats.map((s) => s.bucket);
    expect(names).toContain("global");
    expect(names).toContain("api");
    expect(names).toContain("search");
  });

  it("should return null for unknown bucket stats", () => {
    const stats = limiter.getStats("nonexistent");
    expect(stats).toBeNull();
  });

  // ─── Reset functionality ───────────────────────────────────────────────

  it("should reset all buckets to initial state", async () => {
    // Use up some tokens
    await limiter.consume("global", 3);
    await limiter.consume("global", 1); // denied

    limiter.reset();

    const stats = limiter.getStats("global");
    expect(stats.current).toBe(5); // Back to max
    expect(stats.total).toBe(0);
    expect(stats.denied).toBe(0);
    expect(stats.peak).toBe(0);
  });

  it("should reset a specific named bucket", async () => {
    limiter.createBucket("api", { maxTokens: 10 });
    await limiter.consume("api", 5);

    const resetResult = limiter.resetBucket("api");
    expect(resetResult).toBe(true);

    const stats = limiter.getStats("api");
    expect(stats.current).toBe(10);
    expect(stats.total).toBe(0);
  });

  it("should return false when resetting a non-existent bucket", () => {
    const result = limiter.resetBucket("nonexistent");
    expect(result).toBe(false);
  });

  // ─── Event emission ────────────────────────────────────────────────────

  it("should emit 'rate_limited' event when requests are denied", async () => {
    const events = [];
    limiter.on("rate_limited", (data) => {
      events.push(data);
    });

    // Exhaust and deny
    for (let i = 0; i < 6; i++) {
      await limiter.consume("global", 1);
    }

    expect(events.length).toBe(1);
    expect(events[0].bucket).toBe("global");
    expect(events[0].denied).toBe(1);
  });
});
