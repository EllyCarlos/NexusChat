import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createRedisClient,
  type NodeRedisClient,
} from "../../src/infrastructure/redis/redis-client.js";
import {
  createRedisSocketConnectionDirectory,
  type RedisSocketConnectionDirectory,
} from "../../src/infrastructure/redis/redis-socket-connection-directory.js";
import { createRedisSocketEventRateLimitProvider } from "../../src/infrastructure/redis/redis-socket-event-rate-limit.js";
import {
  createRedisRuntime,
  type RedisRuntime,
} from "../../src/infrastructure/redis/redis-runtime.js";
import { SOCKET_CONNECTION_REDIS_KEYS } from "../../src/infrastructure/redis/socket-connection-scripts.js";
import { SOCKET_EVENT_RATE_LIMIT_REDIS_KEY_PREFIX } from "../../src/infrastructure/redis/socket-event-rate-limit-script.js";
import type { RateLimitPolicy } from "../../src/security/rate-limit.js";
import { createSocketEventRateLimitBucketIdentity } from "../../src/socket/socket-event-rate-limit.port.js";

const redisUrl = process.env.NEXUSCHAT_LIVE_REDIS_URL;
const disposableAcknowledged =
  process.env.NEXUSCHAT_LIVE_REDIS_DISPOSABLE === "true";

if (!redisUrl || !disposableAcknowledged) {
  throw new Error(
    "Live Redis tests require NEXUSCHAT_LIVE_REDIS_URL and "
      + "NEXUSCHAT_LIVE_REDIS_DISPOSABLE=true.",
  );
}

const parsedRedisUrl = new URL(redisUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(parsedRedisUrl.hostname)) {
  throw new Error("Phase 2D-5 live tests require a disposable local Redis.");
}

const RUN_ID = randomUUID().replaceAll("-", "");
const TEST_PREFIX = `nexuschat-2d5-${RUN_ID}`;
const SHORT_LEASE_TTL_MS = 600;
const CLAIM_TTL_MS = 300;

const clients: NodeRedisClient[] = [];
const runtimes: RedisRuntime<NodeRedisClient>[] = [];
const testUsers = new Set<string>();
const testConnections = new Map<string, Set<string>>();
const rateLimitKeys = new Set<string>();

let clientA: NodeRedisClient;
let clientB: NodeRedisClient;
let inspector: NodeRedisClient;
let directoryA: RedisSocketConnectionDirectory;
let directoryB: RedisSocketConnectionDirectory;

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const waitFor = async (
  predicate: () => Promise<boolean>,
  timeoutMilliseconds = 3_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(25);
  }
  throw new Error("Timed out waiting for live Redis state.");
};

const unique = (label: string): string =>
  `${TEST_PREFIX}-${label}-${randomUUID().slice(0, 8)}`;

const trackConnection = (userId: string, socketId: string): void => {
  testUsers.add(userId);
  const sockets = testConnections.get(userId) ?? new Set<string>();
  sockets.add(socketId);
  testConnections.set(userId, sockets);
};

const encodedConnectionKey = (userId: string, socketId: string): string =>
  `${Buffer.from(userId).toString("base64url")}.${Buffer.from(socketId).toString("base64url")}`;

const policy = (
  namespace: string,
  limit: number,
  windowMs: number,
): RateLimitPolicy => ({ namespace, limit, windowMs });

const rateLimitKey = (
  ratePolicy: RateLimitPolicy,
  keyParts: readonly string[],
): string => {
  const key = `${SOCKET_EVENT_RATE_LIMIT_REDIS_KEY_PREFIX}${
    createSocketEventRateLimitBucketIdentity(ratePolicy, keyParts)
  }`;
  rateLimitKeys.add(key);
  return key;
};

const sendExactCommand = async (args: string[]): Promise<unknown> =>
  inspector.sendCommand(args);

const deleteExactTestState = async (): Promise<void> => {
  const users = [...testUsers];
  const connectionKeys = [...testConnections.entries()].flatMap(
    ([userId, sockets]) => [...sockets].map((socketId) =>
      encodedConnectionKey(userId, socketId)),
  );

  if (users.length > 0) {
    await sendExactCommand([
      "HDEL",
      SOCKET_CONNECTION_REDIS_KEYS.connections,
      ...users,
    ]);
    await sendExactCommand([
      "ZREM",
      SOCKET_CONNECTION_REDIS_KEYS.onlineUsers,
      ...users,
    ]);
    await sendExactCommand([
      "HDEL",
      SOCKET_CONNECTION_REDIS_KEYS.presenceCurrent,
      ...users,
    ]);
    await sendExactCommand([
      "ZREM",
      SOCKET_CONNECTION_REDIS_KEYS.presencePending,
      ...users,
    ]);
    await sendExactCommand([
      "HDEL",
      SOCKET_CONNECTION_REDIS_KEYS.presenceClaims,
      ...users,
    ]);
    await sendExactCommand([
      "ZREM",
      SOCKET_CONNECTION_REDIS_KEYS.presenceCleanup,
      ...users,
    ]);
  }

  if (connectionKeys.length > 0) {
    await sendExactCommand([
      "ZREM",
      SOCKET_CONNECTION_REDIS_KEYS.leases,
      ...connectionKeys,
    ]);
    await sendExactCommand([
      "HDEL",
      SOCKET_CONNECTION_REDIS_KEYS.owners,
      ...connectionKeys,
    ]);
  }

  if (rateLimitKeys.size > 0) {
    await sendExactCommand(["DEL", ...rateLimitKeys]);
  }
};

beforeAll(async () => {
  for (let index = 0; index < 3; index += 1) {
    const client = createRedisClient({ url: redisUrl });
    const runtime = createRedisRuntime(client);
    clients.push(client);
    runtimes.push(runtime);
    await runtime.connect();
    expect(runtime.isReady).toBe(true);
  }

  [clientA, clientB, inspector] = clients;
  directoryA = createRedisSocketConnectionDirectory({
    executor: clientA,
    leaseTtlMilliseconds: SHORT_LEASE_TTL_MS,
  });
  directoryB = createRedisSocketConnectionDirectory({
    executor: clientB,
    leaseTtlMilliseconds: SHORT_LEASE_TTL_MS,
  });
});

afterAll(async () => {
  try {
    await deleteExactTestState();
  } finally {
    for (const runtime of [...runtimes].reverse()) {
      await runtime.close();
    }
  }
});

describe("Phase 2D-5 actual Redis connection-state Lua", () => {
  it("atomically caps repeated seven-plus-two contention at eight", async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const userId = unique(`cap-user-${attempt}`);
      const seededSockets = Array.from(
        { length: 7 },
        (_, index) => unique(`cap-seed-${attempt}-${index}`),
      );
      for (const socketId of seededSockets) {
        trackConnection(userId, socketId);
        expect((await directoryA.add(userId, socketId, 8)).accepted).toBe(true);
      }

      const socketA = unique(`cap-race-a-${attempt}`);
      const socketB = unique(`cap-race-b-${attempt}`);
      trackConnection(userId, socketA);
      trackConnection(userId, socketB);
      const decisions = await Promise.all([
        directoryA.add(userId, socketA, 8),
        directoryB.add(userId, socketB, 8),
      ]);

      expect(decisions.filter((decision) => decision.accepted)).toHaveLength(1);
      expect(await directoryA.connectionCount(userId)).toBe(8);
    }
  });

  it("accepts a duplicate at cap without reordering and rejects a ninth socket", async () => {
    const userId = unique("duplicate-user");
    const sockets = Array.from(
      { length: 8 },
      (_, index) => unique(`duplicate-socket-${index}`),
    );
    for (const socketId of sockets) {
      trackConnection(userId, socketId);
      await directoryA.add(userId, socketId, 8);
    }

    const latestBefore = await directoryA.getLatestSocket(userId);
    const duplicate = await directoryB.add(userId, sockets[0], 8);
    expect(duplicate).toMatchObject({
      accepted: true,
      firstConnection: false,
    });
    expect(await directoryB.connectionCount(userId)).toBe(8);
    expect(await directoryB.getLatestSocket(userId)).toBe(latestBefore);

    const ninth = unique("duplicate-ninth");
    trackConnection(userId, ninth);
    expect(await directoryB.add(userId, ninth, 8)).toMatchObject({
      accepted: false,
      firstConnection: false,
    });
    expect(await directoryA.connectionCount(userId)).toBe(8);
  });

  it("preserves latest-socket and online-user insertion order across renew/remove/re-add", async () => {
    const orderingUsers = [
      unique("online-user-a"),
      unique("online-user-b"),
      unique("online-user-c"),
    ];
    const [userA, userB, userC] = orderingUsers;
    const socketA = unique("latest-a");
    const socketB = unique("latest-b");
    const socketC = unique("latest-c");
    for (const [userId, socketId] of [
      [userA, socketA],
      [userB, socketB],
      [userC, socketC],
    ] as const) {
      trackConnection(userId, socketId);
      await directoryA.add(userId, socketId);
    }

    const sameUser = unique("latest-shared-user");
    const latestOwnerA = createRedisSocketConnectionDirectory({
      executor: clientA,
      leaseTtlMilliseconds: SHORT_LEASE_TTL_MS,
    });
    const latestOwnerB = createRedisSocketConnectionDirectory({
      executor: clientB,
      leaseTtlMilliseconds: SHORT_LEASE_TTL_MS,
    });
    const latestOwnerC = createRedisSocketConnectionDirectory({
      executor: clientA,
      leaseTtlMilliseconds: SHORT_LEASE_TTL_MS,
    });
    for (const [owner, socketId] of [
      [latestOwnerA, socketA],
      [latestOwnerB, socketB],
      [latestOwnerC, socketC],
    ] as const) {
      trackConnection(sameUser, socketId);
      await owner.add(sameUser, socketId);
    }
    expect(await directoryA.getLatestSocket(sameUser)).toBe(socketC);

    await latestOwnerA.renewOwnedLeases();
    expect(await directoryA.getLatestSocket(sameUser)).toBe(socketC);
    await latestOwnerB.renewOwnedLeases();
    expect(await directoryA.getLatestSocket(sameUser)).toBe(socketC);

    await latestOwnerC.remove(sameUser, socketC);
    expect(await directoryA.getLatestSocket(sameUser)).toBe(socketB);
    await latestOwnerB.remove(sameUser, socketB);
    await latestOwnerB.add(sameUser, socketB);
    expect(await directoryA.getLatestSocket(sameUser)).toBe(socketB);

    const initialOnlineOrder = (await directoryA.onlineUserIds())
      .filter((userId) => orderingUsers.includes(userId));
    expect(initialOnlineOrder).toEqual([userA, userB, userC]);

    const secondSocketA = unique("online-user-a-second");
    trackConnection(userA, secondSocketA);
    await directoryB.add(userA, secondSocketA);
    expect((await directoryA.onlineUserIds()).filter((userId) =>
      orderingUsers.includes(userId))).toEqual([userA, userB, userC]);

    await directoryA.remove(userB, socketB);
    expect((await directoryA.onlineUserIds()).filter((userId) =>
      orderingUsers.includes(userId))).toEqual([userA, userC]);
    await directoryA.add(userB, socketB);
    expect((await directoryA.onlineUserIds()).filter((userId) =>
      orderingUsers.includes(userId))).toEqual([userA, userC, userB]);
  });

  it("renews a lease without reordering, then reaps actual partial and final expiry", async () => {
    const renewedUser = unique("renewed-user");
    const renewedSocket = unique("renewed-socket");
    trackConnection(renewedUser, renewedSocket);
    await directoryA.add(renewedUser, renewedSocket);
    await sleep(350);
    expect(await directoryA.renewOwnedLeases()).toMatchObject({
      renewedCount: expect.any(Number),
      missingConnections: [],
    });
    await sleep(350);
    expect(await directoryB.getSockets(renewedUser)).toEqual([renewedSocket]);

    const partialUser = unique("partial-expiry-user");
    const shortSocket = unique("partial-short");
    const longSocket = unique("partial-long");
    const shortDirectory = createRedisSocketConnectionDirectory({
      executor: clientA,
      leaseTtlMilliseconds: 300,
    });
    const longDirectory = createRedisSocketConnectionDirectory({
      executor: clientB,
      leaseTtlMilliseconds: 900,
    });
    trackConnection(partialUser, shortSocket);
    trackConnection(partialUser, longSocket);
    await shortDirectory.add(partialUser, shortSocket);
    await longDirectory.add(partialUser, longSocket);
    await sleep(425);
    const firstReap = await directoryA.reapExpiredLeases();
    expect(firstReap.transitions.filter((transition) =>
      transition.userId === partialUser)).toEqual([]);
    expect(await directoryA.getSockets(partialUser)).toEqual([longSocket]);

    await sleep(600);
    const finalReap = await directoryB.reapExpiredLeases();
    const offline = finalReap.transitions.find((transition) =>
      transition.userId === partialUser);
    expect(offline).toMatchObject({ userId: partialUser, state: "offline" });
    expect(await directoryA.isOnline(partialUser)).toBe(false);
    expect((await directoryA.listPendingPresence()).some((transition) =>
      transition.userId === partialUser && transition.state === "offline"))
      .toBe(true);
  });

  it("executes real claim/get/release/complete/recovery and settled cleanup scripts", async () => {
    const userId = unique("presence-user");
    const socketId = unique("presence-socket");
    trackConnection(userId, socketId);
    const registration = await directoryA.add(userId, socketId);
    expect(registration.presenceTransition?.state).toBe("online");

    const tokenA = unique("claim-a");
    const claimedA = await directoryA.claimPresence(
      userId,
      tokenA,
      CLAIM_TTL_MS,
    );
    expect(claimedA?.state).toBe("online");
    await directoryB.releasePresence(userId, unique("wrong-token"));
    expect(await directoryA.getClaimedPresence(userId, tokenA)).toEqual(claimedA);

    await sleep(CLAIM_TTL_MS + 100);
    const tokenB = unique("claim-b");
    expect((await directoryB.claimPresence(
      userId,
      tokenB,
      CLAIM_TTL_MS,
    ))?.state).toBe("online");
    await directoryB.releasePresence(userId, tokenB);
    expect(await directoryA.getClaimedPresence(userId, tokenB)).toBeUndefined();

    const staleToken = unique("stale-claim");
    const staleTruth = await directoryA.claimPresence(
      userId,
      staleToken,
      1_000,
    );
    expect(staleTruth?.state).toBe("online");
    const removal = await directoryB.remove(userId, socketId);
    expect(removal.presenceTransition?.state).toBe("offline");
    expect(await directoryA.completePresence(
      userId,
      staleToken,
      staleTruth!.version,
    )).toBe(false);

    const current = (await directoryA.listPendingPresence()).find(
      (transition) => transition.userId === userId,
    );
    expect(current?.state).toBe("offline");
    expect(current!.version).toBeGreaterThan(staleTruth!.version);
    const currentToken = unique("current-claim");
    expect((await directoryA.claimPresence(
      userId,
      currentToken,
      1_000,
    ))?.version).toBe(current!.version);
    expect(await directoryA.completePresence(
      userId,
      currentToken,
      current!.version,
    )).toBe(true);

    await inspector.zAdd(SOCKET_CONNECTION_REDIS_KEYS.presenceCleanup, {
      score: Date.now() - 1_000,
      value: userId,
    });
    const cleanup = await directoryB.cleanupSettledPresence();
    expect(cleanup.cleanedCount).toBeGreaterThanOrEqual(1);
    expect(await inspector.hExists(
      SOCKET_CONNECTION_REDIS_KEYS.presenceCurrent,
      userId,
    )).toBe(0);
  });
});

describe("Phase 2D-5 actual Redis rate-limit Lua", () => {
  it("uses a fixed non-sliding TTL, rejects without incrementing, and resets after expiry", async () => {
    const limiter = createRedisSocketEventRateLimitProvider({ executor: clientA });
    const ratePolicy = policy(unique("fixed-window"), 2, 800);
    const keyParts = [unique("fixed-subject")];
    const key = rateLimitKey(ratePolicy, keyParts);

    expect(await limiter.consume(ratePolicy, keyParts)).toBe(true);
    const firstState = await inspector.hGetAll(key);
    const firstTtl = await inspector.pTTL(key);
    expect(firstState.count).toBe("1");
    expect(firstTtl).toBeGreaterThan(500);

    await sleep(150);
    expect(await limiter.consume(ratePolicy, keyParts)).toBe(true);
    const secondTtl = await inspector.pTTL(key);
    expect((await inspector.hGetAll(key)).count).toBe("2");
    expect(secondTtl).toBeLessThan(firstTtl - 75);

    await sleep(100);
    expect(await limiter.consume(ratePolicy, keyParts)).toBe(false);
    const rejectedState = await inspector.hGetAll(key);
    const rejectedTtl = await inspector.pTTL(key);
    expect(rejectedState.count).toBe("2");
    expect(rejectedTtl).toBeLessThan(secondTtl);

    await waitFor(async () => await inspector.exists(key) === 0);
    expect(await limiter.consume(ratePolicy, keyParts)).toBe(true);
    expect((await inspector.hGetAll(key)).count).toBe("1");
    expect(await inspector.pTTL(key)).toBeGreaterThan(500);
  });

  it("enforces one global allowance across two independent providers under contention", async () => {
    const limiterA = createRedisSocketEventRateLimitProvider({ executor: clientA });
    const limiterB = createRedisSocketEventRateLimitProvider({ executor: clientB });

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const ratePolicy = policy(unique(`contention-policy-${attempt}`), 17, 5_000);
      const keyParts = [unique(`contention-subject-${attempt}`)];
      rateLimitKey(ratePolicy, keyParts);
      const decisions = await Promise.all(Array.from(
        { length: 48 },
        (_, index) => (index % 2 === 0 ? limiterA : limiterB)
          .consume(ratePolicy, keyParts),
      ));
      expect(decisions.filter(Boolean)).toHaveLength(ratePolicy.limit);
      expect(await limiterA.consume(ratePolicy, keyParts)).toBe(false);
      expect(await limiterB.consume(ratePolicy, keyParts)).toBe(false);
    }
  });

  it("shares identical buckets while isolating namespace and subject without raw key material", async () => {
    const limiterA = createRedisSocketEventRateLimitProvider({ executor: clientA });
    const limiterB = createRedisSocketEventRateLimitProvider({ executor: clientB });
    const shared = policy(unique("isolation-shared"), 1, 5_000);
    const otherNamespace = policy(unique("isolation-other"), 1, 5_000);
    const subject = [unique("private-subject")];
    const otherSubject = [unique("other-subject")];
    const key = rateLimitKey(shared, subject);
    rateLimitKey(otherNamespace, subject);
    rateLimitKey(shared, otherSubject);

    expect(await limiterA.consume(shared, subject)).toBe(true);
    expect(await limiterB.consume(shared, subject)).toBe(false);
    expect(await limiterB.consume(otherNamespace, subject)).toBe(true);
    expect(await limiterB.consume(shared, otherSubject)).toBe(true);
    expect(key).not.toContain(shared.namespace);
    expect(key).not.toContain(subject[0]);
  });

  it("observes real sequential consumeAll partial commits and no rollback on Lua failure", async () => {
    const limiter = createRedisSocketEventRateLimitProvider({ executor: clientA });
    const subject = [unique("consume-all-subject")];

    const first = policy(unique("partial-first"), 2, 5_000);
    const saturatedSecond = policy(unique("partial-second"), 1, 5_000);
    const firstKey = rateLimitKey(first, subject);
    rateLimitKey(saturatedSecond, subject);
    await limiter.consume(saturatedSecond, subject);
    expect(await limiter.consumeAll([first, saturatedSecond], subject)).toBe(false);
    expect((await inspector.hGetAll(firstKey)).count).toBe("1");

    const saturatedFirst = policy(unique("short-first"), 1, 5_000);
    const untouchedSecond = policy(unique("short-second"), 1, 5_000);
    rateLimitKey(saturatedFirst, subject);
    const untouchedKey = rateLimitKey(untouchedSecond, subject);
    await limiter.consume(saturatedFirst, subject);
    expect(await limiter.consumeAll([saturatedFirst, untouchedSecond], subject))
      .toBe(false);
    expect(await inspector.exists(untouchedKey)).toBe(0);

    const committedFirst = policy(unique("failure-first"), 2, 5_000);
    const malformedSecond = policy(unique("failure-second"), 2, 5_000);
    const committedKey = rateLimitKey(committedFirst, subject);
    const malformedKey = rateLimitKey(malformedSecond, subject);
    await inspector.hSet(malformedKey, "count", "1");
    await inspector.pExpire(malformedKey, 5_000);
    await expect(limiter.consumeAll(
      [committedFirst, malformedSecond],
      subject,
    )).rejects.toThrow();
    expect((await inspector.hGetAll(committedKey)).count).toBe("1");
  });
});
