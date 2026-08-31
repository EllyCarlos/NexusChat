import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {},
}));

import type { SocketPresenceTransition } from "../src/socket/connection-directory.js";
import { createPrismaSocketPresencePersistence } from "../src/socket/prisma-socket-presence.persistence.js";

const USER_ID = "presence-user";
const LAST_SEEN = new Date("2026-08-30T12:34:56.789Z");

type Deferred = {
  promise: Promise<void>;
  resolve(): void;
};

const createDeferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const transition = (
  state: SocketPresenceTransition["state"],
  version: number,
): SocketPresenceTransition => ({
  userId: USER_ID,
  state,
  version,
  sourceSocketId: `socket-${version}`,
});

type TransactionHarness = ReturnType<typeof createTransactionHarness>;

const createTransactionHarness = () => {
  const queryRaw = vi.fn(async () => []);
  const update = vi.fn(async () => ({ id: USER_ID }));
  const transaction = {
    $queryRaw: queryRaw,
    user: { update },
  };
  const client = {
    $transaction: vi.fn(async (work: (value: typeof transaction) => unknown) =>
      work(transaction)),
  };

  return { client, queryRaw, update };
};

const createPersistence = (
  harness: TransactionHarness,
  clock = vi.fn(() => LAST_SEEN),
) => createPrismaSocketPresencePersistence({
  client: harness.client as never,
  clock,
});

describe("Prisma socket presence persistence", () => {
  let harness: TransactionHarness;

  beforeEach(() => {
    harness = createTransactionHarness();
  });

  it("holds the User row lock before loading current truth and applying online", async () => {
    const lock = createDeferred();
    const ordering: string[] = [];
    harness.queryRaw.mockImplementationOnce(async () => {
      ordering.push("lock:start");
      await lock.promise;
      ordering.push("lock:held");
      return [];
    });
    harness.update.mockImplementationOnce(async () => {
      ordering.push("update");
      return { id: USER_ID };
    });
    const current = transition("online", 41);
    const loadCurrentClaimedTruth = vi.fn(async () => {
      ordering.push("load-current");
      return current;
    });
    const clock = vi.fn(() => LAST_SEEN);
    const persistence = createPersistence(harness, clock);

    const application = persistence.applySerialized(
      USER_ID,
      loadCurrentClaimedTruth,
    );
    await vi.waitFor(() => expect(harness.queryRaw).toHaveBeenCalledOnce());
    expect(loadCurrentClaimedTruth).not.toHaveBeenCalled();

    lock.resolve();
    await expect(application).resolves.toBe(current);

    expect(ordering).toEqual([
      "lock:start",
      "lock:held",
      "load-current",
      "update",
    ]);
    expect(harness.client.$transaction).toHaveBeenCalledOnce();
    expect(harness.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { isOnline: true },
    });
    expect(clock).not.toHaveBeenCalled();

    const [sqlParts, boundUserId] = harness.queryRaw.mock.calls[0] as unknown as [
      readonly string[],
      string,
    ];
    expect(sqlParts.join("$1").replace(/\s+/g, " ").trim()).toBe(
      'SELECT "id" FROM "User" WHERE "id" = $1 FOR UPDATE',
    );
    expect(boundUserId).toBe(USER_ID);
  });

  it("applies offline truth with the exact injected lastSeen clock value", async () => {
    const current = transition("offline", 42);
    const clock = vi.fn(() => LAST_SEEN);
    const persistence = createPersistence(harness, clock);

    await expect(persistence.applySerialized(
      USER_ID,
      async () => current,
    )).resolves.toBe(current);

    expect(clock).toHaveBeenCalledOnce();
    expect(harness.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { isOnline: false, lastSeen: LAST_SEEN },
    });
  });

  it("does not write when the claimed current truth is missing", async () => {
    const loadCurrentClaimedTruth = vi.fn(async () => undefined);
    const clock = vi.fn(() => LAST_SEEN);
    const persistence = createPersistence(harness, clock);

    await expect(persistence.applySerialized(
      USER_ID,
      loadCurrentClaimedTruth,
    )).resolves.toBeUndefined();

    expect(harness.queryRaw).toHaveBeenCalledOnce();
    expect(loadCurrentClaimedTruth).toHaveBeenCalledOnce();
    expect(harness.update).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
  });

  it("propagates a row-lock failure without loading or writing truth", async () => {
    const failure = new Error("row lock unavailable");
    harness.queryRaw.mockRejectedValueOnce(failure);
    const loadCurrentClaimedTruth = vi.fn(async () => transition("online", 43));
    const persistence = createPersistence(harness);

    await expect(persistence.applySerialized(
      USER_ID,
      loadCurrentClaimedTruth,
    )).rejects.toBe(failure);

    expect(loadCurrentClaimedTruth).not.toHaveBeenCalled();
    expect(harness.update).not.toHaveBeenCalled();
  });

  it("propagates a current-truth loader failure without a database write", async () => {
    const failure = new Error("claimed truth unavailable");
    const persistence = createPersistence(harness);

    await expect(persistence.applySerialized(
      USER_ID,
      async () => { throw failure; },
    )).rejects.toBe(failure);

    expect(harness.queryRaw).toHaveBeenCalledOnce();
    expect(harness.update).not.toHaveBeenCalled();
  });

  it("propagates a database presence-write failure", async () => {
    const failure = new Error("presence update failed");
    harness.update.mockRejectedValueOnce(failure);
    const current = transition("offline", 44);
    const persistence = createPersistence(harness);

    await expect(persistence.applySerialized(
      USER_ID,
      async () => current,
    )).rejects.toBe(failure);

    expect(harness.queryRaw).toHaveBeenCalledOnce();
    expect(harness.update).toHaveBeenCalledOnce();
  });
});
