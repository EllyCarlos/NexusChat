import { describe, expect, it } from "vitest";

import {
  BoundedInMemoryRateLimiter,
  consumeLayeredBackendRateLimit,
  clearBackendRateLimitsForTests,
  type RateLimitPolicy,
} from "../src/security/rate-limit.js";

const policy = (
  namespace: string,
  limit: number,
  windowMs: number,
): RateLimitPolicy => ({ namespace, limit, windowMs });

describe("generic bounded rate limiter characterization", () => {
  it("keeps check non-mutating and creates the first bucket only on consume", () => {
    const limiter = new BoundedInMemoryRateLimiter();
    const oneRequest = policy("core-check", 1, 1_000);

    expect(limiter.check(oneRequest, "subject")).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(limiter.size).toBe(0);
    expect(limiter.consume(oneRequest, "subject")).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(limiter.size).toBe(1);
    expect(limiter.check(oneRequest, "subject")).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });

  it("preserves a fixed reset time across increments and rejects without incrementing", () => {
    let now = 1_000;
    const limiter = new BoundedInMemoryRateLimiter(100, () => now);
    const twoRequests = policy("core-fixed-window", 2, 1_000);

    expect(limiter.consume(twoRequests, "subject").allowed).toBe(true);
    now = 1_500;
    expect(limiter.consume(twoRequests, "subject").allowed).toBe(true);
    expect(limiter.consume(twoRequests, "subject").allowed).toBe(false);

    const threeRequests = { ...twoRequests, limit: 3 };
    expect(limiter.consume(threeRequests, "subject").allowed).toBe(true);
    expect(limiter.consume(threeRequests, "subject").allowed).toBe(false);

    now = 2_000;
    expect(limiter.consume(twoRequests, "subject").allowed).toBe(true);
  });

  it("uses the inclusive expiry boundary and preserves retry rounding", () => {
    let now = 10_000;
    const limiter = new BoundedInMemoryRateLimiter(100, () => now);
    const oneRequest = policy("core-retry", 1, 1_501);

    expect(limiter.consume(oneRequest, "subject").allowed).toBe(true);
    now = 10_001;
    expect(limiter.consume(oneRequest, "subject")).toEqual({
      allowed: false,
      retryAfterSeconds: 2,
    });
    now = 10_502;
    expect(limiter.consume(oneRequest, "subject")).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    now = 11_501;
    expect(limiter.consume(oneRequest, "subject").allowed).toBe(true);
  });

  it("keeps namespaces and logical keys independent", () => {
    const limiter = new BoundedInMemoryRateLimiter();
    const first = policy("core-namespace-a", 1, 1_000);
    const second = policy("core-namespace-b", 1, 1_000);

    expect(limiter.consume(first, "subject-a").allowed).toBe(true);
    expect(limiter.consume(first, "subject-a").allowed).toBe(false);
    expect(limiter.consume(first, "subject-b").allowed).toBe(true);
    expect(limiter.consume(second, "subject-a").allowed).toBe(true);
  });

  it("resets one exact bucket and clears all buckets", () => {
    const limiter = new BoundedInMemoryRateLimiter();
    const oneRequest = policy("core-reset", 1, 1_000);

    limiter.consume(oneRequest, "subject-a");
    limiter.consume(oneRequest, "subject-b");
    limiter.reset(oneRequest, "subject-a");
    expect(limiter.consume(oneRequest, "subject-a").allowed).toBe(true);
    expect(limiter.consume(oneRequest, "subject-b").allowed).toBe(false);

    limiter.clear();
    expect(limiter.size).toBe(0);
    expect(limiter.consume(oneRequest, "subject-b").allowed).toBe(true);
  });

  it("evicts the live entry with the earliest reset when capacity is reached", () => {
    let now = 1_000;
    const limiter = new BoundedInMemoryRateLimiter(2, () => now);
    const later = policy("core-capacity", 1, 2_000);
    const earlier = policy("core-capacity", 1, 1_000);

    limiter.consume(later, "later-subject");
    limiter.consume(earlier, "earlier-subject");
    limiter.consume(later, "new-subject");

    expect(limiter.consume(later, "later-subject").allowed).toBe(false);
    expect(limiter.consume(earlier, "earlier-subject").allowed).toBe(true);
    expect(limiter.size).toBe(2);
    now = 4_001;
    expect(limiter.check(later, "unused").allowed).toBe(true);
    expect(limiter.size).toBe(0);
  });
});

describe("generic layered backend limiter characterization", () => {
  it("commits the first policy and short-circuits after its rejection", () => {
    clearBackendRateLimitsForTests();
    const first = policy("core-layer-first", 1, 60_000);
    const second = policy("core-layer-second", 1, 60_000);

    expect(consumeLayeredBackendRateLimit("subject", first, second).allowed).toBe(true);
    expect(consumeLayeredBackendRateLimit("subject", first, second).allowed).toBe(false);

    clearBackendRateLimitsForTests();
  });
});
