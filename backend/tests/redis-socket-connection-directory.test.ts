import { describe, expect, it, vi } from "vitest";

import {
  RedisSocketConnectionDirectory,
  SOCKET_CONNECTION_LEASE_TTL_MS,
  SOCKET_CONNECTION_RENEWAL_BATCH_SIZE,
  SOCKET_ONLINE_USER_REAP_MAX_PASSES,
  SOCKET_PRESENCE_TRUTH_RETENTION_MS,
} from "../src/infrastructure/redis/redis-socket-connection-directory.js";
import type { RedisScriptExecutor } from "../src/infrastructure/redis/redis-script-executor.js";
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
} from "../src/infrastructure/redis/socket-connection-scripts.js";

const USER_ID = "redis-directory-user";
const SOCKET_ID = "redis-directory-socket";
const CLAIM_TOKEN = "obvious-fake-presence-claim-token";

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

const connectionKey = (userId: string, socketId: string): string =>
  `${Buffer.from(userId).toString("base64url")}.${Buffer.from(socketId).toString("base64url")}`;

const createHarness = () => {
  const evalMock = vi.fn<RedisScriptExecutor["eval"]>();
  const directory = new RedisSocketConnectionDirectory({ eval: evalMock });
  return { directory, evalMock };
};

const onlineTransition = {
  userId: USER_ID,
  state: "online" as const,
  version: 41,
  sourceSocketId: SOCKET_ID,
};

const offlineTransition = {
  userId: USER_ID,
  state: "offline" as const,
  version: 42,
  sourceSocketId: SOCKET_ID,
};

describe("Redis Socket connection directory script boundary", () => {
  it("adds a connection with exactly one EVAL and decodes its online transition", async () => {
    const { directory, evalMock } = createHarness();
    evalMock.mockResolvedValue(JSON.stringify({
      accepted: true,
      firstConnection: true,
      presenceTransition: onlineTransition,
    }));

    await expect(directory.add(USER_ID, SOCKET_ID, 8)).resolves.toEqual({
      accepted: true,
      firstConnection: true,
      presenceTransition: onlineTransition,
    });

    expect(evalMock).toHaveBeenCalledOnce();
    expect(evalMock).toHaveBeenCalledWith(ADD_SOCKET_CONNECTION_SCRIPT, {
      keys: DIRECTORY_TRANSITION_KEYS,
      arguments: [
        USER_ID,
        SOCKET_ID,
        connectionKey(USER_ID, SOCKET_ID),
        "8",
        String(SOCKET_CONNECTION_LEASE_TTL_MS),
      ],
    });
  });

  it("removes a connection with exactly one EVAL and decodes its offline transition", async () => {
    const { directory, evalMock } = createHarness();
    evalMock.mockResolvedValue(JSON.stringify({
      removed: true,
      lastConnection: true,
      presenceTransition: offlineTransition,
    }));

    await expect(directory.remove(USER_ID, SOCKET_ID)).resolves.toEqual({
      removed: true,
      lastConnection: true,
      presenceTransition: offlineTransition,
    });

    expect(evalMock).toHaveBeenCalledOnce();
    expect(evalMock).toHaveBeenCalledWith(REMOVE_SOCKET_CONNECTION_SCRIPT, {
      keys: DIRECTORY_TRANSITION_KEYS,
      arguments: [USER_ID, SOCKET_ID, connectionKey(USER_ID, SOCKET_ID)],
    });
  });

  it("reads sockets, latest socket, online state, and count through the same atomic read", async () => {
    const { directory, evalMock } = createHarness();
    evalMock
      .mockResolvedValueOnce(JSON.stringify({ sockets: ["socket-old", "socket-new"] }))
      .mockResolvedValueOnce(JSON.stringify({ sockets: ["socket-old", "socket-new"] }))
      .mockResolvedValueOnce(JSON.stringify({ sockets: ["socket-new"] }))
      .mockResolvedValueOnce(JSON.stringify({ sockets: ["socket-old", "socket-new"] }))
      .mockResolvedValueOnce(JSON.stringify({ sockets: [] }))
      .mockResolvedValueOnce(JSON.stringify({ sockets: [] }));

    await expect(directory.getSockets(USER_ID)).resolves.toEqual([
      "socket-old",
      "socket-new",
    ]);
    await expect(directory.getLatestSocket(USER_ID)).resolves.toBe("socket-new");
    await expect(directory.isOnline(USER_ID)).resolves.toBe(true);
    await expect(directory.connectionCount(USER_ID)).resolves.toBe(2);
    await expect(directory.getLatestSocket("offline-user")).resolves.toBeUndefined();
    await expect(directory.isOnline("offline-user")).resolves.toBe(false);

    expect(evalMock).toHaveBeenCalledTimes(6);
    expect(evalMock).toHaveBeenNthCalledWith(1, READ_USER_CONNECTIONS_SCRIPT, {
      keys: DIRECTORY_TRANSITION_KEYS,
      arguments: [USER_ID, ""],
    });
    expect(evalMock).toHaveBeenNthCalledWith(4, READ_USER_CONNECTIONS_SCRIPT, {
      keys: DIRECTORY_TRANSITION_KEYS,
      arguments: [USER_ID, ""],
    });
    expect(evalMock).toHaveBeenNthCalledWith(5, READ_USER_CONNECTIONS_SCRIPT, {
      keys: DIRECTORY_TRANSITION_KEYS,
      arguments: ["offline-user", ""],
    });
  });

  it("reaps expired leases before returning globally ordered online users", async () => {
    const { directory, evalMock } = createHarness();
    evalMock
      .mockResolvedValueOnce(JSON.stringify({ complete: false }))
      .mockResolvedValueOnce(JSON.stringify({
        processed: 1,
        more: false,
        consistent: true,
        transitions: [offlineTransition],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        complete: true,
        onlineUserIds: ["user-b", "user-a"],
      }));

    await expect(directory.onlineUserIds()).resolves.toEqual(["user-b", "user-a"]);

    expect(evalMock).toHaveBeenCalledTimes(3);
    expect(evalMock).toHaveBeenNthCalledWith(1, LIST_ONLINE_USERS_SCRIPT, {
      keys: [
        SOCKET_CONNECTION_REDIS_KEYS.leases,
        SOCKET_CONNECTION_REDIS_KEYS.onlineUsers,
      ],
      arguments: [],
    });
    expect(evalMock).toHaveBeenNthCalledWith(2, REAP_EXPIRED_SOCKET_LEASES_SCRIPT, {
      keys: DIRECTORY_TRANSITION_KEYS,
      arguments: ["100"],
    });
    expect(evalMock).toHaveBeenNthCalledWith(3, LIST_ONLINE_USERS_SCRIPT, {
      keys: [
        SOCKET_CONNECTION_REDIS_KEYS.leases,
        SOCKET_CONNECTION_REDIS_KEYS.onlineUsers,
      ],
      arguments: [],
    });
  });

  it("rejects an online-user lookup when lease reaping reports no progress", async () => {
    const { directory, evalMock } = createHarness();
    evalMock
      .mockResolvedValueOnce(JSON.stringify({ complete: false }))
      .mockResolvedValueOnce(JSON.stringify({
        processed: 0,
        more: true,
        consistent: true,
        transitions: [],
      }));

    await expect(directory.onlineUserIds()).rejects.toThrow(
      "Redis lease reaping made no progress.",
    );
    expect(evalMock).toHaveBeenCalledTimes(2);
  });

  it("fails safely instead of returning ghost users from inconsistent lease state", async () => {
    const { directory, evalMock } = createHarness();
    evalMock
      .mockResolvedValueOnce(JSON.stringify({ complete: false }))
      .mockResolvedValueOnce(JSON.stringify({
        processed: 1,
        more: true,
        consistent: false,
        transitions: [],
      }));

    await expect(directory.onlineUserIds()).rejects.toThrow(
      "Redis lease state is inconsistent.",
    );
    expect(evalMock).toHaveBeenCalledTimes(2);
  });

  it("bounds online-user cleanup even while lease reaping keeps progressing", async () => {
    const { directory, evalMock } = createHarness();
    for (let pass = 0; pass < SOCKET_ONLINE_USER_REAP_MAX_PASSES; pass += 1) {
      evalMock
        .mockResolvedValueOnce(JSON.stringify({ complete: false }))
        .mockResolvedValueOnce(JSON.stringify({
          processed: 1,
          more: true,
          consistent: true,
          transitions: [],
        }));
    }
    evalMock.mockResolvedValueOnce(JSON.stringify({ complete: false }));

    await expect(directory.onlineUserIds()).rejects.toThrow(
      "Redis online user cleanup exceeded bounded passes.",
    );
    expect(evalMock).toHaveBeenCalledTimes(
      (SOCKET_ONLINE_USER_REAP_MAX_PASSES * 2) + 1,
    );
  });

  it("renews owned leases in bounded batches and reports/removes missing ownership", async () => {
    const { directory, evalMock } = createHarness();
    const totalConnections = SOCKET_CONNECTION_RENEWAL_BATCH_SIZE + 1;
    const keys = Array.from({ length: totalConnections }, (_, index) =>
      connectionKey(USER_ID, `socket-${index + 1}`));

    evalMock.mockResolvedValue(JSON.stringify({
      accepted: true,
      firstConnection: false,
    }));
    for (let index = 1; index <= totalConnections; index += 1) {
      await directory.add(USER_ID, `socket-${index}`, totalConnections);
    }

    evalMock.mockReset();
    evalMock
      .mockResolvedValueOnce(JSON.stringify({
        renewed: keys.slice(0, SOCKET_CONNECTION_RENEWAL_BATCH_SIZE - 1),
        missing: [keys[SOCKET_CONNECTION_RENEWAL_BATCH_SIZE - 1]],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        renewed: [keys[SOCKET_CONNECTION_RENEWAL_BATCH_SIZE]],
        missing: [],
      }));

    await expect(directory.renewOwnedLeases()).resolves.toEqual({
      renewedCount: totalConnections - 1,
      missingConnections: [{
        userId: USER_ID,
        socketId: `socket-${SOCKET_CONNECTION_RENEWAL_BATCH_SIZE}`,
      }],
    });

    expect(evalMock).toHaveBeenCalledTimes(2);
    expect(evalMock).toHaveBeenNthCalledWith(1, RENEW_SOCKET_LEASES_SCRIPT, {
      keys: [
        SOCKET_CONNECTION_REDIS_KEYS.connections,
        SOCKET_CONNECTION_REDIS_KEYS.leases,
        SOCKET_CONNECTION_REDIS_KEYS.owners,
      ],
      arguments: [
        String(SOCKET_CONNECTION_LEASE_TTL_MS),
        JSON.stringify(keys.slice(0, SOCKET_CONNECTION_RENEWAL_BATCH_SIZE)),
      ],
    });
    expect(evalMock).toHaveBeenNthCalledWith(2, RENEW_SOCKET_LEASES_SCRIPT, {
      keys: [
        SOCKET_CONNECTION_REDIS_KEYS.connections,
        SOCKET_CONNECTION_REDIS_KEYS.leases,
        SOCKET_CONNECTION_REDIS_KEYS.owners,
      ],
      arguments: [
        String(SOCKET_CONNECTION_LEASE_TTL_MS),
        JSON.stringify(keys.slice(SOCKET_CONNECTION_RENEWAL_BATCH_SIZE)),
      ],
    });

    evalMock.mockReset();
    const remainingKeys = [
      ...keys.slice(0, SOCKET_CONNECTION_RENEWAL_BATCH_SIZE - 1),
      keys[SOCKET_CONNECTION_RENEWAL_BATCH_SIZE],
    ];
    evalMock.mockResolvedValue(JSON.stringify({
      renewed: remainingKeys,
      missing: [],
    }));

    await expect(directory.renewOwnedLeases()).resolves.toEqual({
      renewedCount: SOCKET_CONNECTION_RENEWAL_BATCH_SIZE,
      missingConnections: [],
    });
    expect(evalMock).toHaveBeenCalledOnce();
    expect(evalMock.mock.calls[0][1].arguments[1]).toBe(JSON.stringify(remainingKeys));
  });

  it("decodes reaping and pending-presence transitions", async () => {
    const { directory, evalMock } = createHarness();
    evalMock
      .mockResolvedValueOnce(JSON.stringify({
        processed: 2,
        more: true,
        consistent: true,
        transitions: [offlineTransition],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        transitions: [onlineTransition, offlineTransition],
      }));

    await expect(directory.reapExpiredLeases(2)).resolves.toEqual({
      processedCount: 2,
      moreExpired: true,
      transitions: [offlineTransition],
    });
    await expect(directory.listPendingPresence(7)).resolves.toEqual([
      onlineTransition,
      offlineTransition,
    ]);

    expect(evalMock).toHaveBeenNthCalledWith(1, REAP_EXPIRED_SOCKET_LEASES_SCRIPT, {
      keys: DIRECTORY_TRANSITION_KEYS,
      arguments: ["2"],
    });
    expect(evalMock).toHaveBeenNthCalledWith(2, LIST_PENDING_PRESENCE_SCRIPT, {
      keys: [
        SOCKET_CONNECTION_REDIS_KEYS.presenceCurrent,
        SOCKET_CONNECTION_REDIS_KEYS.presencePending,
      ],
      arguments: ["7"],
    });
  });

  it("invokes claim, claimed-read, completion, and release scripts with exact fencing data", async () => {
    const { directory, evalMock } = createHarness();
    evalMock
      .mockResolvedValueOnce(JSON.stringify(onlineTransition))
      .mockResolvedValueOnce(JSON.stringify(onlineTransition))
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    await expect(directory.claimPresence(USER_ID, CLAIM_TOKEN, 15_000)).resolves
      .toEqual(onlineTransition);
    await expect(directory.getClaimedPresence(USER_ID, CLAIM_TOKEN)).resolves
      .toEqual(onlineTransition);
    await expect(directory.completePresence(USER_ID, CLAIM_TOKEN, 41)).resolves.toBe(true);
    await expect(directory.releasePresence(USER_ID, CLAIM_TOKEN)).resolves.toBeUndefined();

    expect(evalMock).toHaveBeenNthCalledWith(1, CLAIM_PRESENCE_SCRIPT, {
      keys: PRESENCE_KEYS,
      arguments: [USER_ID, CLAIM_TOKEN, "15000"],
    });
    expect(evalMock).toHaveBeenNthCalledWith(2, GET_CLAIMED_PRESENCE_SCRIPT, {
      keys: [
        SOCKET_CONNECTION_REDIS_KEYS.presenceCurrent,
        SOCKET_CONNECTION_REDIS_KEYS.presenceClaims,
      ],
      arguments: [USER_ID, CLAIM_TOKEN],
    });
    expect(evalMock).toHaveBeenNthCalledWith(3, COMPLETE_PRESENCE_SCRIPT, {
      keys: [
        ...PRESENCE_KEYS,
        SOCKET_CONNECTION_REDIS_KEYS.presenceCleanup,
      ],
      arguments: [
        USER_ID,
        CLAIM_TOKEN,
        "41",
        String(SOCKET_PRESENCE_TRUTH_RETENTION_MS),
      ],
    });
    expect(evalMock).toHaveBeenNthCalledWith(4, RELEASE_PRESENCE_CLAIM_SCRIPT, {
      keys: [SOCKET_CONNECTION_REDIS_KEYS.presenceClaims],
      arguments: [USER_ID, CLAIM_TOKEN],
    });
  });

  it("decodes no-claim and settled-presence cleanup results", async () => {
    const { directory, evalMock } = createHarness();
    evalMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(JSON.stringify({
        processed: 3,
        cleaned: 2,
        more: true,
      }));

    await expect(directory.claimPresence(USER_ID, CLAIM_TOKEN, 15_000)).resolves
      .toBeUndefined();
    await expect(directory.getClaimedPresence(USER_ID, CLAIM_TOKEN)).resolves
      .toBeUndefined();
    await expect(directory.cleanupSettledPresence(3)).resolves.toEqual({
      processedCount: 3,
      cleanedCount: 2,
      moreSettled: true,
    });

    expect(evalMock).toHaveBeenNthCalledWith(3, CLEANUP_SETTLED_PRESENCE_SCRIPT, {
      keys: [
        SOCKET_CONNECTION_REDIS_KEYS.presenceCurrent,
        SOCKET_CONNECTION_REDIS_KEYS.presencePending,
        SOCKET_CONNECTION_REDIS_KEYS.presenceClaims,
        SOCKET_CONNECTION_REDIS_KEYS.presenceCleanup,
      ],
      arguments: ["3", String(SOCKET_PRESENCE_TRUTH_RETENTION_MS)],
    });
  });

  it("rejects unbounded maintenance arguments before invoking Redis", async () => {
    const { directory, evalMock } = createHarness();

    await expect(directory.reapExpiredLeases(0)).rejects.toThrow(
      "Invalid Redis lease reaping batch limit.",
    );
    await expect(directory.listPendingPresence(101)).rejects.toThrow(
      "Invalid Redis pending presence batch limit.",
    );
    await expect(directory.claimPresence(USER_ID, CLAIM_TOKEN, -1)).rejects.toThrow(
      "Invalid Redis presence claim TTL.",
    );
    await expect(directory.cleanupSettledPresence(0)).rejects.toThrow(
      "Invalid Redis settled presence cleanup batch limit.",
    );
    expect(evalMock).not.toHaveBeenCalled();
  });
});

type InvalidResponseCase = {
  name: string;
  response: unknown;
  invoke: (directory: RedisSocketConnectionDirectory) => Promise<unknown>;
};

const invalidResponseCases: InvalidResponseCase[] = [
  {
    name: "a non-string registration",
    response: {},
    invoke: (directory) => directory.add(USER_ID, SOCKET_ID),
  },
  {
    name: "malformed registration JSON",
    response: "{",
    invoke: (directory) => directory.add(USER_ID, SOCKET_ID),
  },
  {
    name: "a registration transition with a non-positive version",
    response: JSON.stringify({
      accepted: true,
      firstConnection: true,
      presenceTransition: { ...onlineTransition, version: 0 },
    }),
    invoke: (directory) => directory.add(USER_ID, SOCKET_ID),
  },
  {
    name: "a removal missing its last-connection flag",
    response: JSON.stringify({ removed: true }),
    invoke: (directory) => directory.remove(USER_ID, SOCKET_ID),
  },
  {
    name: "a lookup containing a non-string socket ID",
    response: JSON.stringify({ sockets: [SOCKET_ID, 7] }),
    invoke: (directory) => directory.getSockets(USER_ID),
  },
  {
    name: "an online-user response with a non-boolean completion flag",
    response: JSON.stringify({ complete: "yes", onlineUserIds: [] }),
    invoke: (directory) => directory.onlineUserIds(),
  },
  {
    name: "a lease-reaping response with a fractional processed count",
    response: JSON.stringify({
      processed: 1.5,
      more: false,
      consistent: true,
      transitions: [],
    }),
    invoke: (directory) => directory.reapExpiredLeases(),
  },
  {
    name: "a pending-presence response with an invalid state",
    response: JSON.stringify({
      transitions: [{ ...onlineTransition, state: "away" }],
    }),
    invoke: (directory) => directory.listPendingPresence(),
  },
  {
    name: "malformed claimed-presence JSON",
    response: "not-json",
    invoke: (directory) => directory.claimPresence(USER_ID, CLAIM_TOKEN, 15_000),
  },
  {
    name: "a non-binary completion result",
    response: 2,
    invoke: (directory) => directory.completePresence(USER_ID, CLAIM_TOKEN, 41),
  },
  {
    name: "a non-binary claim-release result",
    response: "1",
    invoke: (directory) => directory.releasePresence(USER_ID, CLAIM_TOKEN),
  },
  {
    name: "a cleanup response with a negative cleaned count",
    response: JSON.stringify({ processed: 1, cleaned: -1, more: false }),
    invoke: (directory) => directory.cleanupSettledPresence(),
  },
];

describe("Redis Socket connection directory response validation", () => {
  it.each(invalidResponseCases)("rejects $name", async ({ response, invoke }) => {
    const { directory, evalMock } = createHarness();
    evalMock.mockResolvedValue(response);

    await expect(invoke(directory)).rejects.toThrow(/^Invalid Redis /);
  });

  it("rejects a malformed lease-renewal response", async () => {
    const { directory, evalMock } = createHarness();
    evalMock.mockResolvedValueOnce(JSON.stringify({
      accepted: true,
      firstConnection: true,
    }));
    await directory.add(USER_ID, SOCKET_ID);
    evalMock.mockResolvedValueOnce(JSON.stringify({ renewed: [7], missing: [] }));

    await expect(directory.renewOwnedLeases()).rejects.toThrow(
      "Invalid Redis lease renewal response.",
    );
  });
});

// This deliberately models only the release predicate. It is not a Redis emulator.
const releaseClaimModel = (
  claims: Map<string, string>,
  userId: string,
  token: string,
): 0 | 1 => {
  const currentToken = claims.get(userId);
  if (currentToken === undefined || currentToken !== token) return 0;
  claims.delete(userId);
  return 1;
};

describe("presence claim release guard", () => {
  it("keeps no-claim, wrong-token, correct-token, and unrelated-claim cases explicit", () => {
    const claims = new Map<string, string>([
      [USER_ID, CLAIM_TOKEN],
      ["another-user", "another-token"],
    ]);

    expect(releaseClaimModel(claims, "missing-user", CLAIM_TOKEN)).toBe(0);
    expect(releaseClaimModel(claims, USER_ID, "wrong-token")).toBe(0);
    expect(claims.get(USER_ID)).toBe(CLAIM_TOKEN);
    expect(releaseClaimModel(claims, USER_ID, CLAIM_TOKEN)).toBe(1);
    expect(claims.has(USER_ID)).toBe(false);
    expect(claims.get("another-user")).toBe("another-token");
  });

  it("guards the production release script deletion with the matching claim token", () => {
    const missingClaimGuard = RELEASE_PRESENCE_CLAIM_SCRIPT.indexOf(
      "if not claim_raw then",
    );
    const tokenGuard = RELEASE_PRESENCE_CLAIM_SCRIPT.indexOf(
      "if claim.token ~= token then",
    );
    const deletion = RELEASE_PRESENCE_CLAIM_SCRIPT.indexOf(
      "return redis.call('HDEL', KEYS[1], user_id)",
    );

    expect(missingClaimGuard).toBeGreaterThan(-1);
    expect(tokenGuard).toBeGreaterThan(missingClaimGuard);
    expect(deletion).toBeGreaterThan(tokenGuard);
  });
});
