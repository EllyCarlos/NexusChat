import { describe, expect, it, vi } from "vitest";

import type { RateLimitPolicy } from "../src/security/rate-limit.js";
import {
  MAX_CONNECTIONS_PER_USER,
  SocketConnectionRegistry,
  SocketPresenceWriteQueue,
} from "../src/socket/connection-registry.js";
import { SocketEventRateLimiter } from "../src/socket/socket-security.js";

const USER_A = "distributed-user-a";
const USER_B = "distributed-user-b";

describe("process-local Socket connection registry characterization", () => {
  it("freezes the literal cap and exact first, later, duplicate-at-cap, and over-cap add results", () => {
    const registry = new SocketConnectionRegistry();

    expect(MAX_CONNECTIONS_PER_USER).toBe(8);
    expect(registry.add(USER_A, "socket-1")).toEqual({
      accepted: true,
      firstConnection: true,
    });
    expect(registry.add(USER_A, "socket-2")).toEqual({
      accepted: true,
      firstConnection: false,
    });

    for (let index = 3; index <= MAX_CONNECTIONS_PER_USER; index += 1) {
      expect(registry.add(USER_A, `socket-${index}`)).toEqual({
        accepted: true,
        firstConnection: false,
      });
    }

    expect(registry.connectionCount(USER_A)).toBe(8);
    expect(registry.getLatestSocket(USER_A)).toBe("socket-8");
    expect(registry.add(USER_A, "socket-1")).toEqual({
      accepted: true,
      firstConnection: false,
    });
    expect(registry.connectionCount(USER_A)).toBe(8);
    expect(registry.getLatestSocket(USER_A)).toBe("socket-8");
    expect(registry.add(USER_A, "socket-9")).toEqual({
      accepted: false,
      firstConnection: false,
    });
    expect(registry.connectionCount(USER_A)).toBe(8);
    expect(registry.getLatestSocket(USER_A)).toBe("socket-8");
  });

  it("freezes exact non-final, final, and unknown removal results", () => {
    const registry = new SocketConnectionRegistry();
    registry.add(USER_A, "socket-old");
    registry.add(USER_A, "socket-latest");

    expect(registry.remove(USER_A, "socket-old")).toEqual({
      removed: true,
      lastConnection: false,
    });
    expect(registry.connectionCount(USER_A)).toBe(1);
    expect(registry.remove(USER_A, "socket-unknown")).toEqual({
      removed: false,
      lastConnection: false,
    });
    expect(registry.connectionCount(USER_A)).toBe(1);
    expect(registry.remove(USER_A, "socket-latest")).toEqual({
      removed: true,
      lastConnection: true,
    });
    expect(registry.connectionCount(USER_A)).toBe(0);
    expect(registry.isOnline(USER_A)).toBe(false);
    expect(registry.remove(USER_A, "socket-latest")).toEqual({
      removed: false,
      lastConnection: false,
    });
  });

  it("falls back to the older socket and makes a removed-and-re-added socket latest again", () => {
    const registry = new SocketConnectionRegistry();
    registry.add(USER_A, "socket-old");
    registry.add(USER_A, "socket-latest");

    expect(registry.getLatestSocket(USER_A)).toBe("socket-latest");
    registry.remove(USER_A, "socket-latest");
    expect(registry.getLatestSocket(USER_A)).toBe("socket-old");

    expect(registry.add(USER_A, "socket-latest")).toEqual({
      accepted: true,
      firstConnection: false,
    });
    expect(registry.getLatestSocket(USER_A)).toBe("socket-latest");
  });

  it("preserves online-user insertion order across final removal and re-add", () => {
    const registry = new SocketConnectionRegistry();
    registry.add(USER_A, "socket-a-1");
    registry.add(USER_B, "socket-b-1");
    registry.add(USER_A, "socket-a-2");

    expect(registry.onlineUserIds()).toEqual([USER_A, USER_B]);
    registry.remove(USER_A, "socket-a-1");
    expect(registry.onlineUserIds()).toEqual([USER_A, USER_B]);
    registry.remove(USER_A, "socket-a-2");
    expect(registry.onlineUserIds()).toEqual([USER_B]);

    registry.add(USER_A, "socket-a-3");
    expect(registry.onlineUserIds()).toEqual([USER_B, USER_A]);
  });

  it("keeps separate registry instances independent", () => {
    const firstRegistry = new SocketConnectionRegistry();
    const secondRegistry = new SocketConnectionRegistry();

    expect(firstRegistry.add(USER_A, "socket-first-instance")).toEqual({
      accepted: true,
      firstConnection: true,
    });
    expect(secondRegistry.connectionCount(USER_A)).toBe(0);
    expect(secondRegistry.isOnline(USER_A)).toBe(false);
    expect(secondRegistry.onlineUserIds()).toEqual([]);
    expect(secondRegistry.add(USER_A, "socket-second-instance")).toEqual({
      accepted: true,
      firstConnection: true,
    });
    expect(firstRegistry.getSockets(USER_A)).toEqual(["socket-first-instance"]);
    expect(secondRegistry.getSockets(USER_A)).toEqual(["socket-second-instance"]);
  });
});

describe("process-local Socket presence queue characterization", () => {
  it("allows a different user's operation to finish while the first user is blocked", async () => {
    const queue = new SocketPresenceWriteQueue();
    const order: string[] = [];
    let releaseUserA: (() => void) | undefined;

    const userAOperation = queue.run(USER_A, async () => {
      order.push("user-a-start");
      await new Promise<void>((resolve) => {
        releaseUserA = resolve;
      });
      order.push("user-a-end");
    });

    await vi.waitFor(() => expect(releaseUserA).toBeTypeOf("function"));
    const userBOperation = queue.run(USER_B, async () => {
      order.push("user-b");
    });

    await userBOperation;
    expect(order).toEqual(["user-a-start", "user-b"]);
    releaseUserA!();
    await userAOperation;
    expect(order).toEqual(["user-a-start", "user-b", "user-a-end"]);
  });

  it("propagates a failed operation but still runs the next operation for that user", async () => {
    const queue = new SocketPresenceWriteQueue();
    const failure = new Error("presence write failed");
    const order: string[] = [];

    const failedOperation = queue.run(USER_A, async () => {
      order.push("failed");
      throw failure;
    });
    const recoveredOperation = queue.run(USER_A, async () => {
      order.push("recovered");
      return "recovery-result";
    });

    await expect(failedOperation).rejects.toBe(failure);
    await expect(recoveredOperation).resolves.toBe("recovery-result");
    expect(order).toEqual(["failed", "recovered"]);
  });
});

describe("process-local Socket event limiter characterization", () => {
  const policy = (namespace: string, limit: number): RateLimitPolicy => ({
    namespace,
    limit,
    windowMs: 60_000,
  });

  it("keeps separate limiter instances independent", () => {
    const firstLimiter = new SocketEventRateLimiter();
    const secondLimiter = new SocketEventRateLimiter();
    const oneRequest = policy("independent-instance-policy", 1);
    const keyParts = [USER_A];

    expect(firstLimiter.consume(oneRequest, keyParts)).toBe(true);
    expect(firstLimiter.consume(oneRequest, keyParts)).toBe(false);
    expect(secondLimiter.consume(oneRequest, keyParts)).toBe(true);
    expect(secondLimiter.consume(oneRequest, keyParts)).toBe(false);
  });

  it("consumes policies in order without rolling back earlier buckets after a later rejection", () => {
    const limiter = new SocketEventRateLimiter();
    const earlierPolicy = policy("consume-all-earlier", 2);
    const rejectingPolicy = policy("consume-all-rejecting", 1);
    const skippedPolicy = policy("consume-all-skipped", 1);
    const keyParts = [USER_A, "resource"];

    expect(limiter.consume(rejectingPolicy, keyParts)).toBe(true);
    expect(limiter.consumeAll(
      [earlierPolicy, rejectingPolicy, skippedPolicy],
      keyParts,
    )).toBe(false);

    expect(limiter.consume(earlierPolicy, keyParts)).toBe(true);
    expect(limiter.consume(earlierPolicy, keyParts)).toBe(false);
    expect(limiter.consume(skippedPolicy, keyParts)).toBe(true);
    expect(limiter.consume(skippedPolicy, keyParts)).toBe(false);
  });
});
