import { createHash } from "node:crypto";

export const RATE_LIMIT_MESSAGE = "Too many requests. Please try again later.";

export type RateLimitPolicy = {
  namespace: string;
  limit: number;
  windowMs: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const hashLimiterKey = (namespace: string, key: string) =>
  createHash("sha256").update(namespace).update("\0").update(key).digest("base64url");

export class BoundedInMemoryRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();

  constructor(
    private readonly maxEntries = 5_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get size(): number {
    return this.entries.size;
  }

  check(policy: RateLimitPolicy, key: string): RateLimitDecision {
    const now = this.now();
    this.cleanupExpired(now);
    const entry = this.entries.get(hashLimiterKey(policy.namespace, key));
    if (!entry) return { allowed: true, retryAfterSeconds: 0 };

    return entry.count >= policy.limit
      ? { allowed: false, retryAfterSeconds: this.retryAfter(entry.resetAt, now) }
      : { allowed: true, retryAfterSeconds: 0 };
  }

  consume(policy: RateLimitPolicy, key: string): RateLimitDecision {
    const now = this.now();
    this.cleanupExpired(now);
    const hashedKey = hashLimiterKey(policy.namespace, key);
    const existing = this.entries.get(hashedKey);

    if (existing) {
      if (existing.count >= policy.limit) {
        return { allowed: false, retryAfterSeconds: this.retryAfter(existing.resetAt, now) };
      }
      existing.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }

    this.ensureCapacity();
    this.entries.set(hashedKey, { count: 1, resetAt: now + policy.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  reset(policy: Pick<RateLimitPolicy, "namespace">, key: string): void {
    this.entries.delete(hashLimiterKey(policy.namespace, key));
  }

  clear(): void {
    this.entries.clear();
  }

  private cleanupExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }

  private ensureCapacity(): void {
    if (this.entries.size < this.maxEntries) return;

    let earliestKey: string | undefined;
    let earliestReset = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.entries) {
      if (entry.resetAt < earliestReset) {
        earliestKey = key;
        earliestReset = entry.resetAt;
      }
    }
    if (earliestKey) this.entries.delete(earliestKey);
  }

  private retryAfter(resetAt: number, now: number): number {
    return Math.max(1, Math.ceil((resetAt - now) / 1000));
  }
}

const backendRateLimiter = new BoundedInMemoryRateLimiter();

export const checkBackendRateLimit = (policy: RateLimitPolicy, key: string) =>
  backendRateLimiter.check(policy, key);

export const consumeBackendRateLimit = (policy: RateLimitPolicy, key: string) =>
  backendRateLimiter.consume(policy, key);

export const resetBackendRateLimit = (policy: Pick<RateLimitPolicy, "namespace">, key: string) =>
  backendRateLimiter.reset(policy, key);

export const clearBackendRateLimitsForTests = () => backendRateLimiter.clear();

export const consumeLayeredBackendRateLimit = (
  key: string,
  first: RateLimitPolicy,
  second: RateLimitPolicy,
): RateLimitDecision => {
  const firstDecision = consumeBackendRateLimit(first, key);
  return firstDecision.allowed ? consumeBackendRateLimit(second, key) : firstDecision;
};
