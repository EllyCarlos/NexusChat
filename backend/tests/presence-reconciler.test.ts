import { describe, expect, it } from "vitest";

import type { SocketPresenceTransition } from "../src/socket/connection-directory.js";
import type {
  SettledPresenceCleanup,
  SocketConnectionStateMaintenance,
  SocketLeaseReaping,
  SocketLeaseRenewal,
} from "../src/socket/connection-state-maintenance.js";
import {
  SOCKET_PRESENCE_CLAIM_TTL_MS,
  SOCKET_PRESENCE_RECONCILIATION_BATCH_SIZE,
  SOCKET_PRESENCE_RECONCILIATION_MAX_PASSES,
  SocketPresenceReconciler,
  type ClaimedPresenceLoader,
  type SocketPresencePersistencePort,
  type SocketPresencePublisherPort,
} from "../src/socket/presence-reconciler.js";

const USER_ID = "presence-user";

type Deferred<T = void> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

const createDeferred = <T = void>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

type PresenceClaim = {
  token: string;
  expiresAt: number;
};

class LogicalPresenceMaintenance implements SocketConnectionStateMaintenance {
  readonly claimCalls: Array<{
    userId: string;
    token: string;
    claimTtlMilliseconds: number;
  }> = [];
  readonly completionCalls: Array<{
    userId: string;
    token: string;
    version: number;
  }> = [];
  readonly releaseCalls: Array<{ userId: string; token: string }> = [];
  claimFailuresRemaining = 0;
  private readonly current = new Map<string, SocketPresenceTransition>();
  private readonly pending = new Set<string>();
  private readonly claims = new Map<string, PresenceClaim>();
  private now = 1_000;

  enqueue(transition: SocketPresenceTransition): void {
    this.current.set(transition.userId, transition);
    this.pending.add(transition.userId);
  }

  advance(milliseconds: number): void {
    this.now += milliseconds;
  }

  getCurrent(userId: string): SocketPresenceTransition | undefined {
    return this.current.get(userId);
  }

  hasPending(userId: string): boolean {
    return this.pending.has(userId);
  }

  getClaim(userId: string): PresenceClaim | undefined {
    return this.claims.get(userId);
  }

  async renewOwnedLeases(): Promise<SocketLeaseRenewal> {
    return { renewedCount: 0, missingConnections: [] };
  }

  async reapExpiredLeases(): Promise<SocketLeaseReaping> {
    return { processedCount: 0, moreExpired: false, transitions: [] };
  }

  async listPendingPresence(limit = 100): Promise<SocketPresenceTransition[]> {
    return [...this.pending]
      .map((userId) => this.current.get(userId))
      .filter((transition): transition is SocketPresenceTransition =>
        transition !== undefined)
      .sort((left, right) => left.version - right.version)
      .slice(0, limit);
  }

  async claimPresence(
    userId: string,
    token: string,
    claimTtlMilliseconds: number,
  ): Promise<SocketPresenceTransition | undefined> {
    this.claimCalls.push({ userId, token, claimTtlMilliseconds });
    if (this.claimFailuresRemaining > 0) {
      this.claimFailuresRemaining -= 1;
      throw new Error("presence claim failed");
    }
    const desired = this.current.get(userId);
    if (!desired || !this.pending.has(userId)) return undefined;

    const existing = this.claims.get(userId);
    if (existing && existing.expiresAt > this.now && existing.token !== token) {
      return undefined;
    }

    this.claims.set(userId, {
      token,
      expiresAt: this.now + claimTtlMilliseconds,
    });
    return desired;
  }

  async getClaimedPresence(
    userId: string,
    token: string,
  ): Promise<SocketPresenceTransition | undefined> {
    const claim = this.claims.get(userId);
    if (!claim || claim.token !== token || claim.expiresAt <= this.now) {
      return undefined;
    }
    return this.current.get(userId);
  }

  async completePresence(
    userId: string,
    token: string,
    version: number,
  ): Promise<boolean> {
    this.completionCalls.push({ userId, token, version });
    const claim = this.claims.get(userId);
    if (!claim || claim.token !== token || claim.expiresAt <= this.now) {
      return false;
    }

    const current = this.current.get(userId);
    if (!current || current.version !== version) {
      this.claims.delete(userId);
      return false;
    }

    this.pending.delete(userId);
    this.claims.delete(userId);
    return true;
  }

  async releasePresence(userId: string, token: string): Promise<void> {
    this.releaseCalls.push({ userId, token });
    if (this.claims.get(userId)?.token === token) {
      this.claims.delete(userId);
    }
  }

  async cleanupSettledPresence(): Promise<SettledPresenceCleanup> {
    return { processedCount: 0, cleanedCount: 0, moreSettled: false };
  }
}

class SerializedPresencePersistence implements SocketPresencePersistencePort {
  readonly writes: SocketPresenceTransition[] = [];
  readonly persisted = new Map<string, boolean>();
  readonly lastSeenWrites = new Map<string, number>();
  beforeLoad?: () => Promise<void>;
  afterLoad?: (transition: SocketPresenceTransition) => Promise<void>;
  failuresRemaining = 0;
  private readonly queues = new Map<string, Promise<unknown>>();

  async applySerialized(
    userId: string,
    loadCurrentClaimedTruth: ClaimedPresenceLoader,
  ): Promise<SocketPresenceTransition | undefined> {
    const previous = this.queues.get(userId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      await this.beforeLoad?.();
      const transition = await loadCurrentClaimedTruth();
      if (!transition) return undefined;
      await this.afterLoad?.(transition);

      if (this.failuresRemaining > 0) {
        this.failuresRemaining -= 1;
        throw new Error("presence persistence failed");
      }

      this.writes.push(transition);
      this.persisted.set(userId, transition.state === "online");
      if (transition.state === "offline") {
        this.lastSeenWrites.set(
          userId,
          (this.lastSeenWrites.get(userId) ?? 0) + 1,
        );
      }
      return transition;
    });
    this.queues.set(userId, current);

    try {
      return await current;
    } finally {
      if (this.queues.get(userId) === current) {
        this.queues.delete(userId);
      }
    }
  }
}

class RecordingPresencePublisher implements SocketPresencePublisherPort {
  readonly published: SocketPresenceTransition[] = [];

  async publishPresence(transition: SocketPresenceTransition): Promise<void> {
    this.published.push(transition);
  }
}

const transition = (
  state: SocketPresenceTransition["state"],
  version: number,
): SocketPresenceTransition => ({
  userId: USER_ID,
  state,
  version,
  sourceSocketId: `socket-${version}`,
});

const createReconciler = ({
  maintenance,
  persistence,
  publisher,
  tokenPrefix = "worker",
}: {
  maintenance: LogicalPresenceMaintenance;
  persistence: SerializedPresencePersistence;
  publisher: RecordingPresencePublisher;
  tokenPrefix?: string;
}): SocketPresenceReconciler => {
  let sequence = 0;
  return new SocketPresenceReconciler({
    maintenance,
    persistence,
    publisher,
    tokenFactory: () => `${tokenPrefix}-${++sequence}`,
  });
};

describe("Socket presence reconciler", () => {
  it("applies, completes, and publishes normal online then offline truth", async () => {
    const maintenance = new LogicalPresenceMaintenance();
    const persistence = new SerializedPresencePersistence();
    const publisher = new RecordingPresencePublisher();
    const reconciler = createReconciler({ maintenance, persistence, publisher });

    maintenance.enqueue(transition("online", 1));
    await reconciler.reconcileUser(USER_ID);
    expect(persistence.persisted.get(USER_ID)).toBe(true);
    expect(maintenance.getCurrent(USER_ID)).toEqual(transition("online", 1));
    expect(maintenance.hasPending(USER_ID)).toBe(false);

    maintenance.enqueue(transition("offline", 2));
    await reconciler.reconcileUser(USER_ID);

    expect(persistence.writes).toEqual([
      transition("online", 1),
      transition("offline", 2),
    ]);
    expect(persistence.persisted.get(USER_ID)).toBe(false);
    expect(persistence.lastSeenWrites.get(USER_ID)).toBe(1);
    expect(publisher.published).toEqual(persistence.writes);
    expect(maintenance.claimCalls.every(({ claimTtlMilliseconds }) =>
      claimTtlMilliseconds === SOCKET_PRESENCE_CLAIM_TTL_MS)).toBe(true);
  });

  it("does not publish a stale completion and repairs newer desired truth", async () => {
    const maintenance = new LogicalPresenceMaintenance();
    const persistence = new SerializedPresencePersistence();
    const publisher = new RecordingPresencePublisher();
    const reconciler = createReconciler({ maintenance, persistence, publisher });

    maintenance.enqueue(transition("online", 1));
    persistence.afterLoad = async (loaded) => {
      if (loaded.version === 1) maintenance.enqueue(transition("offline", 2));
    };

    await reconciler.reconcileUser(USER_ID);

    expect(persistence.writes).toEqual([
      transition("online", 1),
      transition("offline", 2),
    ]);
    expect(persistence.persisted.get(USER_ID)).toBe(false);
    expect(publisher.published).toEqual([transition("offline", 2)]);
    expect(maintenance.completionCalls.map(({ version }) => version)).toEqual([1, 2]);
  });

  const certifyCrossNodeConvergence = async (
    oldState: SocketPresenceTransition["state"],
    currentState: SocketPresenceTransition["state"],
  ): Promise<{
    maintenance: LogicalPresenceMaintenance;
    persistence: SerializedPresencePersistence;
    publisher: RecordingPresencePublisher;
  }> => {
    const maintenance = new LogicalPresenceMaintenance();
    const persistence = new SerializedPresencePersistence();
    const publisher = new RecordingPresencePublisher();
    const oldTruthLoaded = createDeferred();
    const releaseOldWrite = createDeferred();
    persistence.afterLoad = async (loaded) => {
      if (loaded.version !== 1) return;
      oldTruthLoaded.resolve();
      await releaseOldWrite.promise;
    };
    const workerA = createReconciler({
      maintenance,
      persistence,
      publisher,
      tokenPrefix: "worker-a",
    });
    const workerB = createReconciler({
      maintenance,
      persistence,
      publisher,
      tokenPrefix: "worker-b",
    });

    maintenance.enqueue(transition(oldState, 1));
    const oldReconciliation = workerA.reconcileUser(USER_ID);
    await oldTruthLoaded.promise;

    maintenance.enqueue(transition(currentState, 2));
    const currentReconciliation = workerB.reconcileUser(USER_ID);

    releaseOldWrite.resolve();
    await Promise.all([oldReconciliation, currentReconciliation]);
    return { maintenance, persistence, publisher };
  };

  it("repairs a slow stale online write with newer offline truth", async () => {
    const { maintenance, persistence, publisher } =
      await certifyCrossNodeConvergence("online", "offline");

    expect(persistence.writes).toEqual([
      transition("online", 1),
      transition("offline", 2),
    ]);
    expect(persistence.persisted.get(USER_ID)).toBe(false);
    expect(persistence.lastSeenWrites.get(USER_ID)).toBe(1);
    expect(maintenance.getCurrent(USER_ID)).toEqual(transition("offline", 2));
    expect(publisher.published).toEqual([transition("offline", 2)]);
  });

  it("repairs a slow stale offline write with newer online truth", async () => {
    const { maintenance, persistence, publisher } =
      await certifyCrossNodeConvergence("offline", "online");

    expect(persistence.writes).toEqual([
      transition("offline", 1),
      transition("online", 2),
    ]);
    expect(persistence.persisted.get(USER_ID)).toBe(true);
    expect(persistence.lastSeenWrites.get(USER_ID)).toBe(1);
    expect(maintenance.getCurrent(USER_ID)).toEqual(transition("online", 2));
    expect(publisher.published).toEqual([transition("online", 2)]);
  });

  it("recovers an expired claim in the bounded loop without applying stale work", async () => {
    const maintenance = new LogicalPresenceMaintenance();
    const persistence = new SerializedPresencePersistence();
    const publisher = new RecordingPresencePublisher();
    const reconciler = createReconciler({ maintenance, persistence, publisher });
    let firstLoad = true;
    persistence.beforeLoad = async () => {
      if (!firstLoad) return;
      firstLoad = false;
      maintenance.advance(SOCKET_PRESENCE_CLAIM_TTL_MS + 1);
    };
    maintenance.enqueue(transition("online", 1));

    await reconciler.reconcileUser(USER_ID);

    expect(maintenance.claimCalls).toHaveLength(2);
    expect(persistence.writes).toEqual([transition("online", 1)]);
    expect(publisher.published).toEqual([transition("online", 1)]);
    expect(maintenance.hasPending(USER_ID)).toBe(false);
  });

  it("releases a failed claim, leaves work pending, and succeeds on retry", async () => {
    const maintenance = new LogicalPresenceMaintenance();
    const persistence = new SerializedPresencePersistence();
    const publisher = new RecordingPresencePublisher();
    const reconciler = createReconciler({ maintenance, persistence, publisher });
    persistence.failuresRemaining = 1;
    maintenance.enqueue(transition("offline", 1));

    await expect(reconciler.reconcileUser(USER_ID)).rejects.toThrow(
      "presence persistence failed",
    );
    expect(maintenance.hasPending(USER_ID)).toBe(true);
    expect(maintenance.getClaim(USER_ID)).toBeUndefined();
    expect(publisher.published).toEqual([]);

    await reconciler.reconcileUser(USER_ID);
    expect(persistence.persisted.get(USER_ID)).toBe(false);
    expect(maintenance.hasPending(USER_ID)).toBe(false);
    expect(publisher.published).toEqual([transition("offline", 1)]);
  });

  it("leaves pending truth recoverable when claiming fails, then retries later", async () => {
    const maintenance = new LogicalPresenceMaintenance();
    const persistence = new SerializedPresencePersistence();
    const publisher = new RecordingPresencePublisher();
    const reconciler = createReconciler({ maintenance, persistence, publisher });
    maintenance.claimFailuresRemaining = 1;
    maintenance.enqueue(transition("online", 1));

    await expect(reconciler.reconcileUser(USER_ID)).rejects.toThrow(
      "presence claim failed",
    );
    expect(maintenance.hasPending(USER_ID)).toBe(true);
    expect(persistence.writes).toEqual([]);

    await reconciler.reconcileUser(USER_ID);
    expect(persistence.persisted.get(USER_ID)).toBe(true);
    expect(maintenance.hasPending(USER_ID)).toBe(false);
    expect(publisher.published).toEqual([transition("online", 1)]);
  });

  it("deduplicates same-node work and drain waits for the in-flight write", async () => {
    const maintenance = new LogicalPresenceMaintenance();
    const persistence = new SerializedPresencePersistence();
    const publisher = new RecordingPresencePublisher();
    const writeLoaded = createDeferred();
    const releaseWrite = createDeferred();
    persistence.afterLoad = async () => {
      writeLoaded.resolve();
      await releaseWrite.promise;
    };
    const reconciler = createReconciler({ maintenance, persistence, publisher });
    maintenance.enqueue(transition("online", 1));

    const first = reconciler.reconcileUser(USER_ID);
    const duplicate = reconciler.reconcileUser(USER_ID);
    expect(duplicate).toBe(first);
    await writeLoaded.promise;
    expect(maintenance.claimCalls).toHaveLength(1);

    let drained = false;
    const drain = reconciler.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    releaseWrite.resolve();
    await Promise.all([first, duplicate, drain]);
    expect(drained).toBe(true);
    expect(persistence.writes).toEqual([transition("online", 1)]);
  });

  it("cannot release another worker's replacement claim", async () => {
    const maintenance = new LogicalPresenceMaintenance();
    const persistence = new SerializedPresencePersistence();
    const publisher = new RecordingPresencePublisher();
    const oldTruthLoaded = createDeferred();
    const failOldWrite = createDeferred();
    const currentTruthLoaded = createDeferred();
    const releaseCurrentWrite = createDeferred();
    persistence.afterLoad = async (loaded) => {
      if (loaded.version === 1) {
        oldTruthLoaded.resolve();
        await failOldWrite.promise;
        throw new Error("old worker failed");
      }
      currentTruthLoaded.resolve();
      await releaseCurrentWrite.promise;
    };
    const workerA = createReconciler({
      maintenance,
      persistence,
      publisher,
      tokenPrefix: "worker-a",
    });
    const workerB = createReconciler({
      maintenance,
      persistence,
      publisher,
      tokenPrefix: "worker-b",
    });
    maintenance.enqueue(transition("online", 1));
    const oldReconciliation = workerA.reconcileUser(USER_ID);
    await oldTruthLoaded.promise;

    maintenance.enqueue(transition("offline", 2));
    maintenance.advance(SOCKET_PRESENCE_CLAIM_TTL_MS + 1);
    const currentReconciliation = workerB.reconcileUser(USER_ID);
    while (maintenance.getClaim(USER_ID)?.token !== "worker-b-1") {
      await Promise.resolve();
    }
    failOldWrite.resolve();

    await expect(oldReconciliation).rejects.toThrow("old worker failed");
    await currentTruthLoaded.promise;
    expect(maintenance.getClaim(USER_ID)?.token).toBe("worker-b-1");
    releaseCurrentWrite.resolve();
    await currentReconciliation;

    expect(maintenance.releaseCalls).toContainEqual({
      userId: USER_ID,
      token: "worker-a-1",
    });
    expect(persistence.persisted.get(USER_ID)).toBe(false);
    expect(publisher.published).toEqual([transition("offline", 2)]);
  });

  it("discovers a bounded pending batch and rejects an unbounded request", async () => {
    const maintenance = new LogicalPresenceMaintenance();
    const persistence = new SerializedPresencePersistence();
    const publisher = new RecordingPresencePublisher();
    const reconciler = createReconciler({ maintenance, persistence, publisher });
    maintenance.enqueue(transition("online", 1));

    await expect(reconciler.reconcilePending(1)).resolves.toBe(1);
    await expect(reconciler.reconcilePending(
      SOCKET_PRESENCE_RECONCILIATION_BATCH_SIZE + 1,
    )).rejects.toThrow("Invalid presence reconciliation batch limit.");
  });

  it("bounds repeated stale completions and leaves the newest truth pending", async () => {
    const maintenance = new LogicalPresenceMaintenance();
    const persistence = new SerializedPresencePersistence();
    const publisher = new RecordingPresencePublisher();
    const reconciler = createReconciler({ maintenance, persistence, publisher });
    maintenance.enqueue(transition("online", 1));
    persistence.afterLoad = async (loaded) => {
      maintenance.enqueue(transition(
        loaded.state === "online" ? "offline" : "online",
        loaded.version + 1,
      ));
    };

    await reconciler.reconcileUser(USER_ID);

    expect(maintenance.claimCalls).toHaveLength(
      SOCKET_PRESENCE_RECONCILIATION_MAX_PASSES,
    );
    expect(persistence.writes).toHaveLength(
      SOCKET_PRESENCE_RECONCILIATION_MAX_PASSES,
    );
    expect(maintenance.hasPending(USER_ID)).toBe(true);
    expect(maintenance.getClaim(USER_ID)).toBeUndefined();
    expect(publisher.published).toEqual([]);
  });
});
