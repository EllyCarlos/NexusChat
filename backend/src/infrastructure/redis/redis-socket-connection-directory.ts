import { MAX_CONNECTIONS_PER_USER } from "../../socket/connection-registry.js";
import type {
  DirectoryConnectionRegistration,
  DirectoryConnectionRemoval,
  SocketConnectionDirectory,
  SocketPresenceTransition,
} from "../../socket/connection-directory.js";
import type {
  OwnedSocketConnection,
  SettledPresenceCleanup,
  SocketConnectionStateMaintenance,
  SocketLeaseReaping,
  SocketLeaseRenewal,
} from "../../socket/connection-state-maintenance.js";
import {
  ADD_SOCKET_CONNECTION_SCRIPT,
  CLAIM_PRESENCE_SCRIPT,
  CLEANUP_SETTLED_PRESENCE_SCRIPT,
  COMPLETE_PRESENCE_SCRIPT,
  GET_CLAIMED_PRESENCE_SCRIPT,
  LIST_ONLINE_USERS_SCRIPT,
  LIST_PENDING_PRESENCE_SCRIPT,
  READ_USER_CONNECTIONS_SCRIPT,
  REAP_EXPIRED_SOCKET_LEASES_SCRIPT,
  RELEASE_PRESENCE_CLAIM_SCRIPT,
  REMOVE_SOCKET_CONNECTION_SCRIPT,
  RENEW_SOCKET_LEASES_SCRIPT,
  SOCKET_CONNECTION_REDIS_KEYS,
} from "./socket-connection-scripts.js";
import type { RedisScriptExecutor } from "./redis-script-executor.js";

export type {
  RedisEvalOptions,
  RedisScriptExecutor,
} from "./redis-script-executor.js";

export const SOCKET_CONNECTION_LEASE_TTL_MS = 90_000;
export const SOCKET_CONNECTION_RENEWAL_BATCH_SIZE = 100;
export const SOCKET_CONNECTION_REAP_BATCH_SIZE = 100;
export const SOCKET_ONLINE_USER_REAP_MAX_PASSES = 8;
export const SOCKET_PRESENCE_PENDING_BATCH_SIZE = 100;
export const SOCKET_PRESENCE_TRUTH_RETENTION_MS = 300_000;
export const SOCKET_PRESENCE_CLEANUP_BATCH_SIZE = 100;

type RedisDirectoryOptions = {
  executor: RedisScriptExecutor;
  leaseTtlMilliseconds?: number;
};

type UserConnectionsRead = {
  sockets: string[];
  presenceTransition?: SocketPresenceTransition;
};

type OnlineUsersRead = {
  complete: boolean;
  onlineUserIds?: string[];
};

type RenewalRead = {
  renewed: string[];
  missing: string[];
};

type ReapingRead = {
  processed: number;
  more: boolean;
  consistent: boolean;
  transitions: SocketPresenceTransition[];
};

type PendingPresenceRead = {
  transitions: SocketPresenceTransition[];
};

type PresenceCleanupRead = {
  processed: number;
  cleaned: number;
  more: boolean;
};

const DIRECTORY_TRANSITION_KEYS = [
  SOCKET_CONNECTION_REDIS_KEYS.sequence,
  SOCKET_CONNECTION_REDIS_KEYS.connections,
  SOCKET_CONNECTION_REDIS_KEYS.leases,
  SOCKET_CONNECTION_REDIS_KEYS.owners,
  SOCKET_CONNECTION_REDIS_KEYS.onlineUsers,
  SOCKET_CONNECTION_REDIS_KEYS.presenceCurrent,
  SOCKET_CONNECTION_REDIS_KEYS.presencePending,
  SOCKET_CONNECTION_REDIS_KEYS.presenceCleanup,
];

const PRESENCE_KEYS = [
  SOCKET_CONNECTION_REDIS_KEYS.presenceCurrent,
  SOCKET_CONNECTION_REDIS_KEYS.presencePending,
  SOCKET_CONNECTION_REDIS_KEYS.presenceClaims,
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeRedisArray = (value: unknown, context: string): unknown[] => {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Object.keys(value).length === 0) return [];
  throw new Error(`Invalid Redis ${context} response.`);
};

const parseJsonResponse = (value: unknown, context: string): unknown => {
  if (typeof value !== "string") {
    throw new Error(`Invalid Redis ${context} response.`);
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`Invalid Redis ${context} response.`);
  }
};

const parseStringArray = (value: unknown, context: string): string[] => {
  const values = normalizeRedisArray(value, context);
  if (!values.every((entry) => typeof entry === "string")) {
    throw new Error(`Invalid Redis ${context} response.`);
  }
  return values as string[];
};

const parsePresenceTransition = (
  value: unknown,
  context: string,
): SocketPresenceTransition => {
  if (!isRecord(value)
    || typeof value.userId !== "string"
    || (value.state !== "online" && value.state !== "offline")
    || typeof value.version !== "number"
    || !Number.isSafeInteger(value.version)
    || value.version <= 0
    || typeof value.sourceSocketId !== "string") {
    throw new Error(`Invalid Redis ${context} response.`);
  }

  return {
    userId: value.userId,
    state: value.state,
    version: value.version,
    sourceSocketId: value.sourceSocketId,
  };
};

const parseOptionalTransition = (
  value: Record<string, unknown>,
  context: string,
): SocketPresenceTransition | undefined => value.presenceTransition === undefined
  ? undefined
  : parsePresenceTransition(value.presenceTransition, context);

const parseRegistration = (value: unknown): DirectoryConnectionRegistration => {
  const parsed = parseJsonResponse(value, "connection registration");
  if (!isRecord(parsed)
    || typeof parsed.accepted !== "boolean"
    || typeof parsed.firstConnection !== "boolean") {
    throw new Error("Invalid Redis connection registration response.");
  }

  return {
    accepted: parsed.accepted,
    firstConnection: parsed.firstConnection,
    ...(
      parsed.presenceTransition === undefined
        ? {}
        : { presenceTransition: parsePresenceTransition(
          parsed.presenceTransition,
          "connection registration",
        ) }
    ),
  };
};

const parseRemoval = (value: unknown): DirectoryConnectionRemoval => {
  const parsed = parseJsonResponse(value, "connection removal");
  if (!isRecord(parsed)
    || typeof parsed.removed !== "boolean"
    || typeof parsed.lastConnection !== "boolean") {
    throw new Error("Invalid Redis connection removal response.");
  }

  return {
    removed: parsed.removed,
    lastConnection: parsed.lastConnection,
    ...(
      parsed.presenceTransition === undefined
        ? {}
        : { presenceTransition: parsePresenceTransition(
          parsed.presenceTransition,
          "connection removal",
        ) }
    ),
  };
};

const parseUserConnections = (value: unknown): UserConnectionsRead => {
  const parsed = parseJsonResponse(value, "connection lookup");
  if (!isRecord(parsed)) {
    throw new Error("Invalid Redis connection lookup response.");
  }
  return {
    sockets: parseStringArray(parsed.sockets, "connection lookup"),
    ...(parseOptionalTransition(parsed, "connection lookup")
      ? { presenceTransition: parseOptionalTransition(parsed, "connection lookup") }
      : {}),
  };
};

const parseOnlineUsers = (value: unknown): OnlineUsersRead => {
  const parsed = parseJsonResponse(value, "online users");
  if (!isRecord(parsed) || typeof parsed.complete !== "boolean") {
    throw new Error("Invalid Redis online users response.");
  }

  if (!parsed.complete) return { complete: false };
  return {
    complete: true,
    onlineUserIds: parseStringArray(parsed.onlineUserIds, "online users"),
  };
};

const parseRenewal = (value: unknown): RenewalRead => {
  const parsed = parseJsonResponse(value, "lease renewal");
  if (!isRecord(parsed)) {
    throw new Error("Invalid Redis lease renewal response.");
  }
  return {
    renewed: parseStringArray(parsed.renewed, "lease renewal"),
    missing: parseStringArray(parsed.missing, "lease renewal"),
  };
};

const parseReaping = (value: unknown): ReapingRead => {
  const parsed = parseJsonResponse(value, "lease reaping");
  if (!isRecord(parsed)
    || typeof parsed.processed !== "number"
    || !Number.isSafeInteger(parsed.processed)
    || parsed.processed < 0
    || typeof parsed.more !== "boolean"
    || typeof parsed.consistent !== "boolean") {
    throw new Error("Invalid Redis lease reaping response.");
  }
  if (!parsed.consistent) {
    throw new Error("Redis lease state is inconsistent.");
  }
  const transitionValues = normalizeRedisArray(parsed.transitions, "lease reaping");
  return {
    processed: parsed.processed,
    more: parsed.more,
    consistent: parsed.consistent,
    transitions: transitionValues.map((entry) =>
      parsePresenceTransition(entry, "lease reaping")),
  };
};

const parsePendingPresence = (value: unknown): SocketPresenceTransition[] => {
  const parsed = parseJsonResponse(value, "pending presence");
  if (!isRecord(parsed)) {
    throw new Error("Invalid Redis pending presence response.");
  }
  return normalizeRedisArray(parsed.transitions, "pending presence").map((entry) =>
    parsePresenceTransition(entry, "pending presence"));
};

const parsePresenceCleanup = (value: unknown): PresenceCleanupRead => {
  const parsed = parseJsonResponse(value, "presence cleanup");
  if (!isRecord(parsed)
    || typeof parsed.processed !== "number"
    || !Number.isSafeInteger(parsed.processed)
    || parsed.processed < 0
    || typeof parsed.cleaned !== "number"
    || !Number.isSafeInteger(parsed.cleaned)
    || parsed.cleaned < 0
    || typeof parsed.more !== "boolean") {
    throw new Error("Invalid Redis presence cleanup response.");
  }
  return {
    processed: parsed.processed,
    cleaned: parsed.cleaned,
    more: parsed.more,
  };
};

const parseClaimedPresence = (
  value: unknown,
  context: string,
): SocketPresenceTransition | undefined => {
  if (value === null || value === false || value === 0) return undefined;
  return parsePresenceTransition(parseJsonResponse(value, context), context);
};

const encodeConnectionKey = (userId: string, socketId: string): string =>
  `${Buffer.from(userId).toString("base64url")}.${Buffer.from(socketId).toString("base64url")}`;

const assertPositiveSafeInteger = (
  value: number,
  context: string,
  maximum?: number,
) => {
  if (!Number.isSafeInteger(value) || value <= 0
    || (maximum !== undefined && value > maximum)) {
    throw new Error(`Invalid ${context}.`);
  }
};

export class RedisSocketConnectionDirectory
implements SocketConnectionDirectory, SocketConnectionStateMaintenance {
  private readonly ownedConnections = new Map<string, OwnedSocketConnection>();
  private readonly leaseTtlMilliseconds: number;

  constructor(private readonly executor: RedisScriptExecutor, options: {
    leaseTtlMilliseconds?: number;
  } = {}) {
    this.leaseTtlMilliseconds = options.leaseTtlMilliseconds
      ?? SOCKET_CONNECTION_LEASE_TTL_MS;
    assertPositiveSafeInteger(
      this.leaseTtlMilliseconds,
      "Redis socket lease TTL",
    );
  }

  async add(
    userId: string,
    socketId: string,
    maximumConnections = MAX_CONNECTIONS_PER_USER,
  ): Promise<DirectoryConnectionRegistration> {
    if (this.executor.isReady === false) {
      throw new Error("Redis socket connection directory is not ready.");
    }

    const connectionKey = encodeConnectionKey(userId, socketId);
    const registration = parseRegistration(await this.executor.eval(
      ADD_SOCKET_CONNECTION_SCRIPT,
      {
        keys: [...DIRECTORY_TRANSITION_KEYS],
        arguments: [
          userId,
          socketId,
          connectionKey,
          String(maximumConnections),
          String(this.leaseTtlMilliseconds),
        ],
      },
    ));

    if (registration.accepted) {
      this.ownedConnections.set(connectionKey, { userId, socketId });
    }
    return registration;
  }

  async remove(
    userId: string,
    socketId: string,
  ): Promise<DirectoryConnectionRemoval> {
    const connectionKey = encodeConnectionKey(userId, socketId);
    try {
      return parseRemoval(await this.executor.eval(
        REMOVE_SOCKET_CONNECTION_SCRIPT,
        {
          keys: [...DIRECTORY_TRANSITION_KEYS],
          arguments: [userId, socketId, connectionKey],
        },
      ));
    } finally {
      this.ownedConnections.delete(connectionKey);
    }
  }

  async getSockets(userId: string): Promise<string[]> {
    return (await this.readUserConnections(userId)).sockets;
  }

  async getLatestSocket(userId: string): Promise<string | undefined> {
    const sockets = (await this.readUserConnections(userId)).sockets;
    return sockets[sockets.length - 1];
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.readUserConnections(userId)).sockets.length > 0;
  }

  async connectionCount(userId: string): Promise<number> {
    return (await this.readUserConnections(userId)).sockets.length;
  }

  async onlineUserIds(): Promise<string[]> {
    const listOnlineUsers = async () => parseOnlineUsers(await this.executor.eval(
      LIST_ONLINE_USERS_SCRIPT,
      {
        keys: [
          SOCKET_CONNECTION_REDIS_KEYS.leases,
          SOCKET_CONNECTION_REDIS_KEYS.onlineUsers,
        ],
        arguments: [],
      },
    ));

    for (let pass = 0; pass < SOCKET_ONLINE_USER_REAP_MAX_PASSES; pass += 1) {
      const result = await listOnlineUsers();
      if (result.complete) return result.onlineUserIds ?? [];

      const reaping = await this.reapExpiredLeases();
      if (reaping.processedCount === 0 && reaping.moreExpired) {
        throw new Error("Redis lease reaping made no progress.");
      }
    }

    const finalResult = await listOnlineUsers();
    if (finalResult.complete) return finalResult.onlineUserIds ?? [];
    throw new Error("Redis online user cleanup exceeded bounded passes.");
  }

  async renewOwnedLeases(): Promise<SocketLeaseRenewal> {
    const connectionKeys = [...this.ownedConnections.keys()];
    const missingConnections: OwnedSocketConnection[] = [];
    let renewedCount = 0;

    for (let offset = 0; offset < connectionKeys.length;
      offset += SOCKET_CONNECTION_RENEWAL_BATCH_SIZE) {
      const batch = connectionKeys.slice(
        offset,
        offset + SOCKET_CONNECTION_RENEWAL_BATCH_SIZE,
      );
      const renewal = parseRenewal(await this.executor.eval(
        RENEW_SOCKET_LEASES_SCRIPT,
        {
          keys: [
            SOCKET_CONNECTION_REDIS_KEYS.connections,
            SOCKET_CONNECTION_REDIS_KEYS.leases,
            SOCKET_CONNECTION_REDIS_KEYS.owners,
          ],
          arguments: [String(this.leaseTtlMilliseconds), JSON.stringify(batch)],
        },
      ));
      renewedCount += renewal.renewed.length;

      for (const missingKey of renewal.missing) {
        const connection = this.ownedConnections.get(missingKey);
        if (!connection) continue;
        missingConnections.push(connection);
        this.ownedConnections.delete(missingKey);
      }
    }

    return { renewedCount, missingConnections };
  }

  async reapExpiredLeases(
    limit = SOCKET_CONNECTION_REAP_BATCH_SIZE,
  ): Promise<SocketLeaseReaping> {
    assertPositiveSafeInteger(
      limit,
      "Redis lease reaping batch limit",
      SOCKET_CONNECTION_REAP_BATCH_SIZE,
    );
    const result = parseReaping(await this.executor.eval(
      REAP_EXPIRED_SOCKET_LEASES_SCRIPT,
      {
        keys: [...DIRECTORY_TRANSITION_KEYS],
        arguments: [String(limit)],
      },
    ));
    return {
      processedCount: result.processed,
      moreExpired: result.more,
      transitions: result.transitions,
    };
  }

  async listPendingPresence(
    limit = SOCKET_PRESENCE_PENDING_BATCH_SIZE,
  ): Promise<SocketPresenceTransition[]> {
    assertPositiveSafeInteger(
      limit,
      "Redis pending presence batch limit",
      SOCKET_PRESENCE_PENDING_BATCH_SIZE,
    );
    return parsePendingPresence(await this.executor.eval(
      LIST_PENDING_PRESENCE_SCRIPT,
      {
        keys: [
          SOCKET_CONNECTION_REDIS_KEYS.presenceCurrent,
          SOCKET_CONNECTION_REDIS_KEYS.presencePending,
        ],
        arguments: [String(limit)],
      },
    ));
  }

  async claimPresence(
    userId: string,
    token: string,
    claimTtlMilliseconds: number,
  ): Promise<SocketPresenceTransition | undefined> {
    assertPositiveSafeInteger(
      claimTtlMilliseconds,
      "Redis presence claim TTL",
    );
    return parseClaimedPresence(await this.executor.eval(
      CLAIM_PRESENCE_SCRIPT,
      {
        keys: [...PRESENCE_KEYS],
        arguments: [userId, token, String(claimTtlMilliseconds)],
      },
    ), "presence claim");
  }

  async getClaimedPresence(
    userId: string,
    token: string,
  ): Promise<SocketPresenceTransition | undefined> {
    return parseClaimedPresence(await this.executor.eval(
      GET_CLAIMED_PRESENCE_SCRIPT,
      {
        keys: [
          SOCKET_CONNECTION_REDIS_KEYS.presenceCurrent,
          SOCKET_CONNECTION_REDIS_KEYS.presenceClaims,
        ],
        arguments: [userId, token],
      },
    ), "claimed presence");
  }

  async completePresence(
    userId: string,
    token: string,
    version: number,
  ): Promise<boolean> {
    const result = await this.executor.eval(COMPLETE_PRESENCE_SCRIPT, {
      keys: [
        ...PRESENCE_KEYS,
        SOCKET_CONNECTION_REDIS_KEYS.presenceCleanup,
      ],
      arguments: [
        userId,
        token,
        String(version),
        String(SOCKET_PRESENCE_TRUTH_RETENTION_MS),
      ],
    });
    if (result !== 0 && result !== 1) {
      throw new Error("Invalid Redis presence completion response.");
    }
    return result === 1;
  }

  async releasePresence(userId: string, token: string): Promise<void> {
    const result = await this.executor.eval(RELEASE_PRESENCE_CLAIM_SCRIPT, {
      keys: [SOCKET_CONNECTION_REDIS_KEYS.presenceClaims],
      arguments: [userId, token],
    });
    if (result !== 0 && result !== 1) {
      throw new Error("Invalid Redis presence release response.");
    }
  }

  async cleanupSettledPresence(
    limit = SOCKET_PRESENCE_CLEANUP_BATCH_SIZE,
  ): Promise<SettledPresenceCleanup> {
    assertPositiveSafeInteger(
      limit,
      "Redis settled presence cleanup batch limit",
      SOCKET_PRESENCE_CLEANUP_BATCH_SIZE,
    );
    const result = parsePresenceCleanup(await this.executor.eval(
      CLEANUP_SETTLED_PRESENCE_SCRIPT,
      {
        keys: [
          SOCKET_CONNECTION_REDIS_KEYS.presenceCurrent,
          SOCKET_CONNECTION_REDIS_KEYS.presencePending,
          SOCKET_CONNECTION_REDIS_KEYS.presenceClaims,
          SOCKET_CONNECTION_REDIS_KEYS.presenceCleanup,
        ],
        arguments: [
          String(limit),
          String(SOCKET_PRESENCE_TRUTH_RETENTION_MS),
        ],
      },
    ));
    return {
      processedCount: result.processed,
      cleanedCount: result.cleaned,
      moreSettled: result.more,
    };
  }

  private async readUserConnections(userId: string): Promise<UserConnectionsRead> {
    return parseUserConnections(await this.executor.eval(
      READ_USER_CONNECTIONS_SCRIPT,
      {
        keys: [...DIRECTORY_TRANSITION_KEYS],
        arguments: [userId, ""],
      },
    ));
  }
}

export const createRedisSocketConnectionDirectory = ({
  executor,
  leaseTtlMilliseconds,
}: RedisDirectoryOptions): RedisSocketConnectionDirectory =>
  new RedisSocketConnectionDirectory(executor, {
    ...(leaseTtlMilliseconds === undefined ? {} : { leaseTtlMilliseconds }),
  });
