import { describe, expect, it } from "vitest";

import type { RateLimitPolicy } from "../src/security/rate-limit.js";
import { createSocketEventRateLimitBucketIdentity } from "../src/socket/socket-event-rate-limit.port.js";

/**
 * TEST BOUNDARY: this is a pure shared fixed-window state model, not a Redis
 * emulator. Each consume represents one indivisible server-side transition
 * under one authoritative clock. Lua execution, Redis TIME precision, real
 * contention, and TTL expiry remain Phase 2D-5 integration gates.
 */

type LogicalBucket = {
  count: number;
  resetAt: number;
};

class SharedAtomicRateLimitModel {
  private readonly buckets = new Map<string, LogicalBucket>();

  private readonly failingNamespaces = new Set<string>();

  private serverTimeMilliseconds = 1_000;

  advanceServerTimeBy(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new Error("Server time may only advance by whole milliseconds.");
    }
    this.serverTimeMilliseconds += milliseconds;
  }

  failNamespace(namespace: string): void {
    this.failingNamespaces.add(namespace);
  }

  consume(policy: RateLimitPolicy, keyParts: readonly string[]): boolean {
    if (this.failingNamespaces.has(policy.namespace)) {
      throw new Error("obvious-fake-logical-command-failure");
    }

    const identity = createSocketEventRateLimitBucketIdentity(policy, keyParts);
    const existing = this.buckets.get(identity);
    if (!existing || existing.resetAt <= this.serverTimeMilliseconds) {
      this.buckets.set(identity, {
        count: 1,
        resetAt: this.serverTimeMilliseconds + policy.windowMs,
      });
      return true;
    }

    if (existing.count >= policy.limit) return false;
    existing.count += 1;
    return true;
  }

  bucket(
    policy: RateLimitPolicy,
    keyParts: readonly string[],
  ): LogicalBucket | undefined {
    const bucket = this.buckets.get(
      createSocketEventRateLimitBucketIdentity(policy, keyParts),
    );
    return bucket ? { ...bucket } : undefined;
  }
}

class LogicalBackendNode {
  constructor(private readonly state: SharedAtomicRateLimitModel) {}

  async consume(
    policy: RateLimitPolicy,
    keyParts: readonly string[],
  ): Promise<boolean> {
    return this.state.consume(policy, keyParts);
  }

  async consumeAll(
    policies: readonly RateLimitPolicy[],
    keyParts: readonly string[],
  ): Promise<boolean> {
    for (const policy of policies) {
      if (!await this.consume(policy, keyParts)) return false;
    }
    return true;
  }
}

const createTwoNodeModel = () => {
  const state = new SharedAtomicRateLimitModel();
  return {
    state,
    nodeA: new LogicalBackendNode(state),
    nodeB: new LogicalBackendNode(state),
  };
};

const policy = (
  namespace: string,
  limit = 2,
  windowMs = 100,
): RateLimitPolicy => ({ namespace, limit, windowMs });

const SUBJECT = ["logical-user", "logical-resource"] as const;

describe("distributed Socket rate-limit logical model", () => {
  it("shares one global bucket across node A and node B", async () => {
    const { state, nodeA, nodeB } = createTwoNodeModel();
    const sharedPolicy = policy("shared-global-bucket");

    await expect(nodeA.consume(sharedPolicy, SUBJECT)).resolves.toBe(true);
    expect(state.bucket(sharedPolicy, SUBJECT)).toEqual({
      count: 1,
      resetAt: 1_100,
    });
    await expect(nodeB.consume(sharedPolicy, SUBJECT)).resolves.toBe(true);
    expect(state.bucket(sharedPolicy, SUBJECT)?.count).toBe(2);
    await expect(nodeA.consume(sharedPolicy, SUBJECT)).resolves.toBe(false);
    expect(state.bucket(sharedPolicy, SUBJECT)?.count).toBe(2);
  });

  it("keeps namespaces and subjects independent", async () => {
    const { state, nodeA, nodeB } = createTwoNodeModel();
    const namespaceA = policy("independent-namespace-a", 1);
    const namespaceB = policy("independent-namespace-b", 1);
    const otherSubject = ["other-user", "logical-resource"] as const;

    await expect(nodeA.consume(namespaceA, SUBJECT)).resolves.toBe(true);
    await expect(nodeB.consume(namespaceA, SUBJECT)).resolves.toBe(false);
    await expect(nodeB.consume(namespaceB, SUBJECT)).resolves.toBe(true);
    await expect(nodeB.consume(namespaceA, otherSubject)).resolves.toBe(true);

    expect(state.bucket(namespaceA, SUBJECT)?.count).toBe(1);
    expect(state.bucket(namespaceB, SUBJECT)?.count).toBe(1);
    expect(state.bucket(namespaceA, otherSubject)?.count).toBe(1);
  });

  it("retains the original reset time and starts fresh only after expiry", async () => {
    const { state, nodeA, nodeB } = createTwoNodeModel();
    const fixedWindow = policy("fixed-window", 2, 100);

    await nodeA.consume(fixedWindow, SUBJECT);
    state.advanceServerTimeBy(50);
    await nodeB.consume(fixedWindow, SUBJECT);
    expect(state.bucket(fixedWindow, SUBJECT)).toEqual({
      count: 2,
      resetAt: 1_100,
    });

    await expect(nodeA.consume(fixedWindow, SUBJECT)).resolves.toBe(false);
    expect(state.bucket(fixedWindow, SUBJECT)).toEqual({
      count: 2,
      resetAt: 1_100,
    });

    state.advanceServerTimeBy(50);
    await expect(nodeB.consume(fixedWindow, SUBJECT)).resolves.toBe(true);
    expect(state.bucket(fixedWindow, SUBJECT)).toEqual({
      count: 1,
      resetAt: 1_200,
    });
  });

  it("bounds concurrent logical attempts globally rather than per node", async () => {
    const { state, nodeA, nodeB } = createTwoNodeModel();
    const globalPolicy = policy("concurrent-global", 4);

    const decisions = await Promise.all(Array.from(
      { length: 12 },
      (_, index) => (index % 2 === 0 ? nodeA : nodeB)
        .consume(globalPolicy, SUBJECT),
    ));

    expect(decisions.filter(Boolean)).toHaveLength(4);
    expect(decisions.filter(decision => !decision)).toHaveLength(8);
    expect(state.bucket(globalPolicy, SUBJECT)?.count).toBe(4);
  });
});

describe("distributed Socket rate-limit consumeAll logical matrix", () => {
  it("consumes all policies when every policy allows", async () => {
    const { state, nodeA } = createTwoNodeModel();
    const first = policy("all-first");
    const second = policy("all-second");

    await expect(nodeA.consumeAll([first, second], SUBJECT)).resolves.toBe(true);
    expect(state.bucket(first, SUBJECT)?.count).toBe(1);
    expect(state.bucket(second, SUBJECT)?.count).toBe(1);
  });

  it("retains the first consume when the second policy rejects", async () => {
    const { state, nodeA, nodeB } = createTwoNodeModel();
    const first = policy("partial-first", 2);
    const second = policy("partial-second", 1);
    await nodeB.consume(second, SUBJECT);

    await expect(nodeA.consumeAll([first, second], SUBJECT)).resolves.toBe(false);
    expect(state.bucket(first, SUBJECT)?.count).toBe(1);
    expect(state.bucket(second, SUBJECT)?.count).toBe(1);
  });

  it("does not touch a later policy after the first rejects", async () => {
    const { state, nodeA, nodeB } = createTwoNodeModel();
    const first = policy("first-rejects", 1);
    const second = policy("untouched-second", 2);
    await nodeB.consume(first, SUBJECT);

    await expect(nodeA.consumeAll([first, second], SUBJECT)).resolves.toBe(false);
    expect(state.bucket(first, SUBJECT)?.count).toBe(1);
    expect(state.bucket(second, SUBJECT)).toBeUndefined();
  });

  it("retains two earlier consumes when a third policy rejects", async () => {
    const { state, nodeA, nodeB } = createTwoNodeModel();
    const first = policy("third-reject-first", 2);
    const second = policy("third-reject-second", 2);
    const third = policy("third-reject-third", 1);
    await nodeB.consume(third, SUBJECT);

    await expect(nodeA.consumeAll([first, second, third], SUBJECT))
      .resolves.toBe(false);
    expect(state.bucket(first, SUBJECT)?.count).toBe(1);
    expect(state.bucket(second, SUBJECT)?.count).toBe(1);
    expect(state.bucket(third, SUBJECT)?.count).toBe(1);
  });

  it("retains the first consume when the second operation throws", async () => {
    const { state, nodeA } = createTwoNodeModel();
    const first = policy("failure-first", 2);
    const second = policy("failure-second", 2);
    state.failNamespace(second.namespace);

    await expect(nodeA.consumeAll([first, second], SUBJECT)).rejects.toThrow(
      "obvious-fake-logical-command-failure",
    );
    expect(state.bucket(first, SUBJECT)?.count).toBe(1);
    expect(state.bucket(second, SUBJECT)).toBeUndefined();
  });

  it("does not touch later policies when the first operation throws", async () => {
    const { state, nodeA } = createTwoNodeModel();
    const first = policy("failure-at-first", 2);
    const second = policy("failure-untouched-second", 2);
    state.failNamespace(first.namespace);

    await expect(nodeA.consumeAll([first, second], SUBJECT)).rejects.toThrow(
      "obvious-fake-logical-command-failure",
    );
    expect(state.bucket(first, SUBJECT)).toBeUndefined();
    expect(state.bucket(second, SUBJECT)).toBeUndefined();
  });
});
