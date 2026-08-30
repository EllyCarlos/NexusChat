import { describe, expect, it } from "vitest";

import { MAX_CONNECTIONS_PER_USER } from "../src/socket/connection-registry.js";

/**
 * TEST BOUNDARY: this is a small shared logical state model, not a Redis
 * emulator. It models indivisible state transitions and one authoritative
 * Redis-server clock so two logical backend nodes can exercise the distributed
 * invariants without infrastructure. No Lua is parsed or executed here; live
 * Redis/Lua syntax, contention, and expiry verification remain a Phase 2D-5
 * integration gate.
 */

const MODEL_LEASE_TTL_MS = 100;

type PresenceState = "online" | "offline";

type PresenceTransition = {
  userId: string;
  state: PresenceState;
  version: number;
  sourceSocketId: string;
};

type RegistrationResult = {
  accepted: boolean;
  firstConnection: boolean;
  presenceTransition?: PresenceTransition;
};

type RemovalResult = {
  removed: boolean;
  lastConnection: boolean;
  presenceTransition?: PresenceTransition;
};

type LogicalConnection = {
  ownerId: string;
  sequence: number;
  expiresAt: number;
};

type PresenceClaim = {
  token: string;
  version: number;
  expiresAt: number;
};

type ExpiredConnection = {
  ownerId: string;
  userId: string;
  socketId: string;
};

type ReapingResult = {
  expiredConnections: ExpiredConnection[];
  transitions: PresenceTransition[];
};

const copyTransition = (
  transition: PresenceTransition,
): PresenceTransition => ({ ...transition });

/**
 * Each public mutation completes synchronously. That represents one atomic
 * server-side transition; callers never perform an application-side
 * read/decide/write sequence.
 */
class SharedAtomicConnectionStateModel {
  private readonly connectionsByUser = new Map<
    string,
    Map<string, LogicalConnection>
  >();

  private readonly onlineOrderByUser = new Map<string, number>();

  private readonly currentPresenceByUser = new Map<
    string,
    PresenceTransition
  >();

  private readonly pendingPresenceByUser = new Map<
    string,
    PresenceTransition
  >();

  private readonly claimsByUser = new Map<string, PresenceClaim>();

  private serverTimeMilliseconds = 1_000;

  private registrationSequence = 0;

  private onlineSequence = 0;

  private presenceVersion = 0;

  constructor(private readonly leaseTtlMilliseconds = MODEL_LEASE_TTL_MS) {}

  advanceServerTimeBy(milliseconds: number): void {
    if (!Number.isInteger(milliseconds) || milliseconds < 0) {
      throw new Error("Server time may only advance by whole milliseconds.");
    }
    this.serverTimeMilliseconds += milliseconds;
  }

  add(
    ownerId: string,
    userId: string,
    socketId: string,
    maximumConnections = MAX_CONNECTIONS_PER_USER,
  ): RegistrationResult {
    this.pruneExpiredForUser(userId);

    const existingConnections = this.connectionsByUser.get(userId);
    const duplicate = existingConnections?.get(socketId);
    if (duplicate) {
      duplicate.expiresAt = this.serverTimeMilliseconds
        + this.leaseTtlMilliseconds;
      return { accepted: true, firstConnection: false };
    }

    if ((existingConnections?.size ?? 0) >= maximumConnections) {
      return { accepted: false, firstConnection: false };
    }

    const connections = existingConnections
      ?? new Map<string, LogicalConnection>();
    const firstConnection = connections.size === 0;
    connections.set(socketId, {
      ownerId,
      sequence: ++this.registrationSequence,
      expiresAt: this.serverTimeMilliseconds + this.leaseTtlMilliseconds,
    });
    this.connectionsByUser.set(userId, connections);

    if (!firstConnection) {
      return { accepted: true, firstConnection: false };
    }

    this.onlineOrderByUser.set(userId, ++this.onlineSequence);
    const presenceTransition = this.recordPresence(
      userId,
      "online",
      socketId,
    );
    return {
      accepted: true,
      firstConnection: true,
      presenceTransition,
    };
  }

  remove(userId: string, socketId: string): RemovalResult {
    this.pruneExpiredForUser(userId);
    const connections = this.connectionsByUser.get(userId);
    if (!connections?.delete(socketId)) {
      return { removed: false, lastConnection: false };
    }

    if (connections.size > 0) {
      return { removed: true, lastConnection: false };
    }

    this.connectionsByUser.delete(userId);
    this.onlineOrderByUser.delete(userId);
    const presenceTransition = this.recordPresence(
      userId,
      "offline",
      socketId,
    );
    return {
      removed: true,
      lastConnection: true,
      presenceTransition,
    };
  }

  renew(userId: string, socketId: string): boolean {
    this.pruneExpiredForUser(userId);
    const connection = this.connectionsByUser.get(userId)?.get(socketId);
    if (!connection) return false;

    connection.expiresAt = this.serverTimeMilliseconds
      + this.leaseTtlMilliseconds;
    return true;
  }

  getSockets(userId: string): string[] {
    this.pruneExpiredForUser(userId);
    return [...(this.connectionsByUser.get(userId)?.entries() ?? [])]
      .sort((left, right) => left[1].sequence - right[1].sequence)
      .map(([socketId]) => socketId);
  }

  getLatestSocket(userId: string): string | undefined {
    return this.getSockets(userId).at(-1);
  }

  connectionCount(userId: string): number {
    return this.getSockets(userId).length;
  }

  isOnline(userId: string): boolean {
    return this.connectionCount(userId) > 0;
  }

  onlineUserIds(): string[] {
    this.reapExpired();
    return [...this.onlineOrderByUser.entries()]
      .sort((left, right) => left[1] - right[1])
      .map(([userId]) => userId);
  }

  reapExpired(): ReapingResult {
    const result: ReapingResult = {
      expiredConnections: [],
      transitions: [],
    };

    for (const userId of [...this.connectionsByUser.keys()]) {
      const userResult = this.pruneExpiredForUser(userId);
      result.expiredConnections.push(...userResult.expiredConnections);
      result.transitions.push(...userResult.transitions);
    }

    return result;
  }

  getCurrentPresence(userId: string): PresenceTransition | undefined {
    const transition = this.currentPresenceByUser.get(userId);
    return transition ? copyTransition(transition) : undefined;
  }

  getPendingPresence(userId: string): PresenceTransition | undefined {
    const transition = this.pendingPresenceByUser.get(userId);
    return transition ? copyTransition(transition) : undefined;
  }

  getPresenceClaim(userId: string): PresenceClaim | undefined {
    const claim = this.claimsByUser.get(userId);
    return claim ? { ...claim } : undefined;
  }

  claimPresence(
    userId: string,
    token: string,
    claimTtlMilliseconds: number,
  ): PresenceTransition | undefined {
    const existingClaim = this.claimsByUser.get(userId);
    if (existingClaim?.expiresAt
      && existingClaim.expiresAt > this.serverTimeMilliseconds) {
      return undefined;
    }

    const pending = this.pendingPresenceByUser.get(userId);
    if (!pending) {
      this.claimsByUser.delete(userId);
      return undefined;
    }

    this.claimsByUser.set(userId, {
      token,
      version: pending.version,
      expiresAt: this.serverTimeMilliseconds + claimTtlMilliseconds,
    });
    return copyTransition(pending);
  }

  completePresence(userId: string, token: string, version: number): boolean {
    const claim = this.claimsByUser.get(userId);
    const current = this.currentPresenceByUser.get(userId);
    const pending = this.pendingPresenceByUser.get(userId);

    if (!claim
      || claim.expiresAt <= this.serverTimeMilliseconds
      || claim.token !== token
      || claim.version !== version
      || current?.version !== version
      || pending?.version !== version) {
      return false;
    }

    this.claimsByUser.delete(userId);
    this.pendingPresenceByUser.delete(userId);
    return true;
  }

  private pruneExpiredForUser(userId: string): ReapingResult {
    const connections = this.connectionsByUser.get(userId);
    const result: ReapingResult = {
      expiredConnections: [],
      transitions: [],
    };
    if (!connections) return result;

    let finalExpiredSocketId: string | undefined;
    for (const [socketId, connection] of connections) {
      if (connection.expiresAt > this.serverTimeMilliseconds) continue;

      connections.delete(socketId);
      finalExpiredSocketId = socketId;
      result.expiredConnections.push({
        ownerId: connection.ownerId,
        userId,
        socketId,
      });
    }

    if (connections.size > 0 || !finalExpiredSocketId) return result;

    this.connectionsByUser.delete(userId);
    this.onlineOrderByUser.delete(userId);
    result.transitions.push(this.recordPresence(
      userId,
      "offline",
      finalExpiredSocketId,
    ));
    return result;
  }

  private recordPresence(
    userId: string,
    state: PresenceState,
    sourceSocketId: string,
  ): PresenceTransition {
    const transition: PresenceTransition = {
      userId,
      state,
      version: ++this.presenceVersion,
      sourceSocketId,
    };

    // Current truth intentionally outlives both transient work and ownership.
    this.currentPresenceByUser.set(userId, copyTransition(transition));
    this.pendingPresenceByUser.set(userId, copyTransition(transition));
    return copyTransition(transition);
  }
}

class LogicalBackendNode {
  constructor(
    readonly nodeId: string,
    private readonly sharedState: SharedAtomicConnectionStateModel,
  ) {}

  async add(
    userId: string,
    socketId: string,
    maximumConnections = MAX_CONNECTIONS_PER_USER,
  ): Promise<RegistrationResult> {
    return this.sharedState.add(
      this.nodeId,
      userId,
      socketId,
      maximumConnections,
    );
  }

  async remove(userId: string, socketId: string): Promise<RemovalResult> {
    return this.sharedState.remove(userId, socketId);
  }

  async renew(userId: string, socketId: string): Promise<boolean> {
    return this.sharedState.renew(userId, socketId);
  }

  async getSockets(userId: string): Promise<string[]> {
    return this.sharedState.getSockets(userId);
  }

  async getLatestSocket(userId: string): Promise<string | undefined> {
    return this.sharedState.getLatestSocket(userId);
  }

  async connectionCount(userId: string): Promise<number> {
    return this.sharedState.connectionCount(userId);
  }

  async isOnline(userId: string): Promise<boolean> {
    return this.sharedState.isOnline(userId);
  }

  async onlineUserIds(): Promise<string[]> {
    return this.sharedState.onlineUserIds();
  }
}

const createTwoNodeModel = () => {
  const state = new SharedAtomicConnectionStateModel();
  return {
    state,
    nodeA: new LogicalBackendNode("node-a", state),
    nodeB: new LogicalBackendNode("node-b", state),
  };
};

describe("distributed connection-state logical model", () => {
  it("keeps fourteen simultaneous logical registrations within the global cap of eight", async () => {
    const { nodeA, nodeB } = createTwoNodeModel();
    const registrations = await Promise.all(
      Array.from({ length: 14 }, (_, index) => {
        const node = index % 2 === 0 ? nodeA : nodeB;
        return node.add("cap-user", `socket-${index + 1}`);
      }),
    );

    expect(registrations.filter(({ accepted }) => accepted)).toHaveLength(
      MAX_CONNECTIONS_PER_USER,
    );
    expect(registrations.filter(({ firstConnection }) => firstConnection))
      .toHaveLength(1);
    await expect(nodeA.connectionCount("cap-user")).resolves.toBe(8);
    await expect(nodeB.getSockets("cap-user")).resolves.toHaveLength(8);
  });

  it("renews a duplicate at cap without increasing count or changing newest order", async () => {
    const { nodeA, nodeB } = createTwoNodeModel();
    for (let index = 1; index <= MAX_CONNECTIONS_PER_USER; index += 1) {
      const node = index % 2 === 0 ? nodeB : nodeA;
      await node.add("duplicate-user", `socket-${index}`);
    }

    await expect(nodeB.add("duplicate-user", "socket-1")).resolves.toEqual({
      accepted: true,
      firstConnection: false,
    });
    await expect(nodeA.connectionCount("duplicate-user")).resolves.toBe(8);
    await expect(nodeB.getLatestSocket("duplicate-user")).resolves.toBe(
      "socket-8",
    );
    await expect(nodeA.add("duplicate-user", "socket-9")).resolves.toEqual({
      accepted: false,
      firstConnection: false,
    });
  });

  it("shares count, ordered sockets, latest fallback, and remove/re-add order across nodes", async () => {
    const { nodeA, nodeB } = createTwoNodeModel();
    await nodeA.add("shared-user", "socket-a");
    await nodeB.add("shared-user", "socket-b");

    await expect(nodeB.connectionCount("shared-user")).resolves.toBe(2);
    await expect(nodeA.getSockets("shared-user")).resolves.toEqual([
      "socket-a",
      "socket-b",
    ]);
    await expect(nodeA.getLatestSocket("shared-user")).resolves.toBe(
      "socket-b",
    );

    await expect(nodeB.remove("shared-user", "socket-b")).resolves.toEqual({
      removed: true,
      lastConnection: false,
    });
    await expect(nodeA.getLatestSocket("shared-user")).resolves.toBe(
      "socket-a",
    );

    await nodeB.add("shared-user", "socket-b");
    await expect(nodeA.getSockets("shared-user")).resolves.toEqual([
      "socket-a",
      "socket-b",
    ]);
    await expect(nodeB.getLatestSocket("shared-user")).resolves.toBe(
      "socket-b",
    );
  });

  it("reports final disconnect only after sockets on every logical node are gone", async () => {
    const { nodeA, nodeB } = createTwoNodeModel();
    await nodeA.add("disconnect-user", "socket-a");
    await nodeB.add("disconnect-user", "socket-b");

    await expect(nodeA.remove("disconnect-user", "socket-a")).resolves.toEqual({
      removed: true,
      lastConnection: false,
    });
    await expect(nodeB.isOnline("disconnect-user")).resolves.toBe(true);

    await expect(nodeB.remove("disconnect-user", "socket-b")).resolves
      .toMatchObject({
        removed: true,
        lastConnection: true,
        presenceTransition: {
          userId: "disconnect-user",
          state: "offline",
          sourceSocketId: "socket-b",
        },
      });
    await expect(nodeA.isOnline("disconnect-user")).resolves.toBe(false);
  });

  it("shares global online insertion order and appends a later re-online user", async () => {
    const { nodeA, nodeB } = createTwoNodeModel();
    await nodeA.add("user-a", "socket-a-1");
    await nodeB.add("user-b", "socket-b-1");
    await nodeB.add("user-a", "socket-a-2");

    await expect(nodeA.onlineUserIds()).resolves.toEqual(["user-a", "user-b"]);
    await nodeA.remove("user-a", "socket-a-1");
    await nodeB.remove("user-a", "socket-a-2");
    await expect(nodeB.onlineUserIds()).resolves.toEqual(["user-b"]);

    await nodeA.add("user-a", "socket-a-3");
    await expect(nodeB.onlineUserIds()).resolves.toEqual(["user-b", "user-a"]);
  });

  it("renews a lease without reordering and falls back when the newest lease expires", async () => {
    const { state, nodeA, nodeB } = createTwoNodeModel();
    await nodeA.add("lease-user", "socket-old");
    state.advanceServerTimeBy(10);
    await nodeB.add("lease-user", "socket-newest");
    state.advanceServerTimeBy(80);

    await expect(nodeA.renew("lease-user", "socket-old")).resolves.toBe(true);
    await expect(nodeB.getLatestSocket("lease-user")).resolves.toBe(
      "socket-newest",
    );

    state.advanceServerTimeBy(21);
    expect(state.reapExpired()).toEqual({
      expiredConnections: [{
        ownerId: "node-b",
        userId: "lease-user",
        socketId: "socket-newest",
      }],
      transitions: [],
    });
    await expect(nodeB.getSockets("lease-user")).resolves.toEqual([
      "socket-old",
    ]);
    await expect(nodeA.getLatestSocket("lease-user")).resolves.toBe(
      "socket-old",
    );
  });

  it("turns final lease expiry into pending offline work and removes the user globally", async () => {
    const { state, nodeA, nodeB } = createTwoNodeModel();
    const registration = await nodeA.add("expired-user", "expired-socket");
    expect(registration.presenceTransition).toMatchObject({
      state: "online",
      version: 1,
    });

    state.advanceServerTimeBy(MODEL_LEASE_TTL_MS);
    const reaping = state.reapExpired();
    expect(reaping.transitions).toEqual([{
      userId: "expired-user",
      state: "offline",
      version: 2,
      sourceSocketId: "expired-socket",
    }]);
    expect(state.getPendingPresence("expired-user")).toEqual(
      reaping.transitions[0],
    );
    await expect(nodeB.isOnline("expired-user")).resolves.toBe(false);
    await expect(nodeA.onlineUserIds()).resolves.toEqual([]);
  });

  it("does not create offline work when another node still owns a live lease", async () => {
    const { state, nodeA, nodeB } = createTwoNodeModel();
    await nodeA.add("partially-expired-user", "socket-a");
    state.advanceServerTimeBy(50);
    await nodeB.add("partially-expired-user", "socket-b");
    state.advanceServerTimeBy(50);

    expect(state.reapExpired()).toEqual({
      expiredConnections: [{
        ownerId: "node-a",
        userId: "partially-expired-user",
        socketId: "socket-a",
      }],
      transitions: [],
    });
    await expect(nodeA.getSockets("partially-expired-user")).resolves.toEqual([
      "socket-b",
    ]);
    await expect(nodeB.isOnline("partially-expired-user")).resolves.toBe(true);
    expect(state.getCurrentPresence("partially-expired-user")).toMatchObject({
      state: "online",
      version: 1,
    });
  });

  it("keeps current presence truth separate from pending work and claim ownership after completion", async () => {
    const { state, nodeA } = createTwoNodeModel();
    const registration = await nodeA.add("presence-user", "presence-socket");
    const online = registration.presenceTransition;
    expect(online).toBeDefined();
    expect(state.getCurrentPresence("presence-user")).toEqual(online);
    expect(state.getPendingPresence("presence-user")).toEqual(online);

    expect(state.claimPresence("presence-user", "worker-token", 25)).toEqual(
      online,
    );
    expect(state.getPresenceClaim("presence-user")).toEqual({
      token: "worker-token",
      version: online?.version,
      expiresAt: 1_025,
    });
    expect(state.completePresence(
      "presence-user",
      "worker-token",
      online?.version ?? -1,
    )).toBe(true);

    expect(state.getPendingPresence("presence-user")).toBeUndefined();
    expect(state.getPresenceClaim("presence-user")).toBeUndefined();
    expect(state.getCurrentPresence("presence-user")).toEqual(online);
  });

  it("rejects stale completion while retaining the newer current and pending truth", async () => {
    const { state, nodeA } = createTwoNodeModel();
    const online = (await nodeA.add("fenced-user", "fenced-socket"))
      .presenceTransition;
    expect(online).toBeDefined();
    state.claimPresence("fenced-user", "slow-worker", 25);

    const offline = (await nodeA.remove("fenced-user", "fenced-socket"))
      .presenceTransition;
    expect(offline).toMatchObject({ state: "offline", version: 2 });
    expect(state.completePresence(
      "fenced-user",
      "slow-worker",
      online?.version ?? -1,
    )).toBe(false);
    expect(state.getCurrentPresence("fenced-user")).toEqual(offline);
    expect(state.getPendingPresence("fenced-user")).toEqual(offline);
  });
});
