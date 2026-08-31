import { randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createRedisClient,
  type NodeRedisClient,
} from "../../src/infrastructure/redis/redis-client.js";
import {
  createRedisRuntime,
  type RedisRuntime,
} from "../../src/infrastructure/redis/redis-runtime.js";
import {
  createSocketConnectionStateRuntime,
  type RecurringTask,
  type SocketConnectionStateRuntime,
} from "../../src/infrastructure/redis/socket-connection-state.runtime.js";
import { createRedisSocketConnectionDirectory } from "../../src/infrastructure/redis/redis-socket-connection-directory.js";
import { SOCKET_CONNECTION_REDIS_KEYS } from "../../src/infrastructure/redis/socket-connection-scripts.js";
import type { SocketPresenceTransition } from "../../src/socket/connection-directory.js";

const redisUrl = process.env.NEXUSCHAT_LIVE_REDIS_URL;
const disposableAcknowledged =
  process.env.NEXUSCHAT_LIVE_REDIS_DISPOSABLE === "true";

if (!redisUrl || !disposableAcknowledged) {
  throw new Error(
    "Live crash tests require NEXUSCHAT_LIVE_REDIS_URL and "
      + "NEXUSCHAT_LIVE_REDIS_DISPOSABLE=true.",
  );
}

const parsedRedisUrl = new URL(redisUrl);
if (!['127.0.0.1', 'localhost', '::1'].includes(parsedRedisUrl.hostname)
  || parsedRedisUrl.username
  || parsedRedisUrl.password) {
  throw new Error("Phase 2D-5 crash tests require credential-free local Redis.");
}

const LEASE_TTL_MS = 1_000;
const MAINTENANCE_INTERVAL_MS = 100;
const CHILD_HELPER_PATH = fileURLToPath(new URL(
  "./helpers/phase2d5-crash-owner.ts",
  import.meta.url,
));

const sleep = (milliseconds: number) =>
  new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds));

const waitFor = async (
  predicate: () => Promise<boolean> | boolean,
  timeoutMilliseconds = 5_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(25);
  }
  throw new Error("Timed out waiting for process-crash lease convergence.");
};

const scheduleRecurring = (callback: () => void): RecurringTask => {
  const timer = setInterval(callback, MAINTENANCE_INTERVAL_MS);
  return {
    clear: () => clearInterval(timer),
    unref: () => timer.unref(),
  };
};

const createCrashRuntime = (): SocketConnectionStateRuntime =>
  createSocketConnectionStateRuntime({
    mode: { kind: "distributed", redisUrl },
    dependencies: {
      createDirectory: (executor) => createRedisSocketConnectionDirectory({
        executor,
        leaseTtlMilliseconds: LEASE_TTL_MS,
      }),
      scheduleRecurring,
    },
  });

const waitForChildReady = (child: ChildProcess): Promise<{
  pid: number;
  registrations: Array<{ accepted: boolean }>;
}> => new Promise((resolveReady, reject) => {
  const timeout = setTimeout(() => {
    cleanup();
    reject(new Error("Timed out waiting for the crash-owner child."));
  }, 6_000);
  const cleanup = () => {
    clearTimeout(timeout);
    child.off("message", handleMessage);
    child.off("exit", handleExit);
    child.off("error", handleError);
  };
  const handleMessage = (message: unknown) => {
    if (typeof message !== "object" || message === null) return;
    const record = message as Record<string, unknown>;
    if (record.type === "error") {
      cleanup();
      reject(new Error("The crash-owner child failed before registration."));
      return;
    }
    if (record.type !== "ready"
      || typeof record.pid !== "number"
      || !Array.isArray(record.registrations)) return;
    cleanup();
    resolveReady({
      pid: record.pid,
      registrations: record.registrations as Array<{ accepted: boolean }>,
    });
  };
  const handleExit = () => {
    cleanup();
    reject(new Error("The crash-owner child exited before registration."));
  };
  const handleError = (error: Error) => {
    cleanup();
    reject(error);
  };
  child.on("message", handleMessage);
  child.once("exit", handleExit);
  child.once("error", handleError);
});

const waitForChildExit = (
  child: ChildProcess,
  timeoutMilliseconds = 5_000,
): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for the crash-owner child to exit."));
    }, timeoutMilliseconds);
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("exit", handleExit);
      child.off("error", handleError);
    };
    const handleExit = () => {
      cleanup();
      resolveExit();
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    child.once("exit", handleExit);
    child.once("error", handleError);
  });
};

const clientCount = async (client: NodeRedisClient): Promise<number> => {
  const response = await client.sendCommand(["CLIENT", "LIST"]);
  return String(response).split(/\r?\n/u).filter(Boolean).length;
};

const connectionKey = (userId: string, socketId: string): string =>
  `${Buffer.from(userId).toString("base64url")}.${Buffer.from(socketId).toString("base64url")}`;

const cleanupExactState = async (
  inspector: NodeRedisClient,
  users: readonly string[],
  connections: readonly { userId: string; socketId: string }[],
): Promise<void> => {
  const connectionKeys = connections.map(({ userId, socketId }) =>
    connectionKey(userId, socketId));
  await inspector.sendCommand([
    "HDEL",
    SOCKET_CONNECTION_REDIS_KEYS.connections,
    ...users,
  ]);
  await inspector.sendCommand([
    "ZREM",
    SOCKET_CONNECTION_REDIS_KEYS.leases,
    ...connectionKeys,
  ]);
  await inspector.sendCommand([
    "HDEL",
    SOCKET_CONNECTION_REDIS_KEYS.owners,
    ...connectionKeys,
  ]);
  await inspector.sendCommand([
    "ZREM",
    SOCKET_CONNECTION_REDIS_KEYS.onlineUsers,
    ...users,
  ]);
  await inspector.sendCommand([
    "HDEL",
    SOCKET_CONNECTION_REDIS_KEYS.presenceCurrent,
    ...users,
  ]);
  await inspector.sendCommand([
    "ZREM",
    SOCKET_CONNECTION_REDIS_KEYS.presencePending,
    ...users,
  ]);
  await inspector.sendCommand([
    "HDEL",
    SOCKET_CONNECTION_REDIS_KEYS.presenceClaims,
    ...users,
  ]);
  await inspector.sendCommand([
    "ZREM",
    SOCKET_CONNECTION_REDIS_KEYS.presenceCleanup,
    ...users,
  ]);
};

describe("Phase 2D-5 process-crash lease convergence", () => {
  it("reaps only the crashed owner's leases and produces final offline truth", async () => {
    const runId = randomUUID().replaceAll("-", "");
    const crashOnlyUser = `phase2d5-crash-only-${runId}`;
    const sharedUser = `phase2d5-crash-shared-${runId}`;
    const survivorSocket = `phase2d5-survivor-${runId}`;
    const crashedSocket = `phase2d5-crashed-${runId}`;
    const crashedSharedSocket = `phase2d5-crashed-shared-${runId}`;
    const users = [crashOnlyUser, sharedUser];
    const connections = [
      { userId: sharedUser, socketId: survivorSocket },
      { userId: crashOnlyUser, socketId: crashedSocket },
      { userId: sharedUser, socketId: crashedSharedSocket },
    ];
    const inspector = createRedisClient({ url: redisUrl });
    const inspectorRuntime: RedisRuntime<NodeRedisClient> = createRedisRuntime(inspector);
    let survivingRuntime: SocketConnectionStateRuntime | undefined;
    let child: ChildProcess | undefined;
    const observedTransitions: SocketPresenceTransition[] = [];
    const killChildOnParentExit = () => {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    };
    process.once("exit", killChildOnParentExit);

    try {
      await inspectorRuntime.connect();
      const baselineClients = await clientCount(inspector);
      survivingRuntime = createCrashRuntime();
      await survivingRuntime.connect();
      const maintenance = survivingRuntime.maintenance;
      if (!maintenance) throw new Error("Distributed maintenance is unavailable.");
      await survivingRuntime.start({
        handleLostConnection: () => undefined,
        reconcilePresence: async (userId) => {
          const token = `phase2d5-claim-${runId}-${randomUUID()}`;
          const transition = await maintenance.claimPresence(userId, token, 500);
          if (!transition) return;
          if (!observedTransitions.some((candidate) =>
            candidate.userId === transition.userId
            && candidate.version === transition.version)) {
            observedTransitions.push(transition);
          }
          await maintenance.releasePresence(userId, token);
        },
      });
      expect(await clientCount(inspector)).toBe(baselineClients + 1);
      expect((await survivingRuntime.directory.add(
        sharedUser,
        survivorSocket,
      )).accepted).toBe(true);

      const childEnvironment: NodeJS.ProcessEnv = {
        NEXUSCHAT_LIVE_REDIS_URL: redisUrl,
        NEXUSCHAT_LIVE_REDIS_DISPOSABLE: "true",
        NEXUSCHAT_LIVE_CRASH_CONNECTIONS: JSON.stringify(connections.slice(1)),
        NEXUSCHAT_LIVE_CRASH_LEASE_TTL_MS: String(LEASE_TTL_MS),
        NEXUSCHAT_LIVE_CRASH_MAINTENANCE_INTERVAL_MS:
          String(MAINTENANCE_INTERVAL_MS),
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
      };
      child = fork(CHILD_HELPER_PATH, [], {
        cwd: process.cwd(),
        env: childEnvironment,
        execArgv: ["--import", "tsx"],
        silent: true,
        windowsHide: true,
      });
      child.stdout?.resume();
      child.stderr?.resume();
      const childReady = await waitForChildReady(child);
      expect(childReady.pid).toBe(child.pid);
      expect(childReady.registrations).toHaveLength(2);
      expect(childReady.registrations.every(({ accepted }) => accepted)).toBe(true);
      expect(await clientCount(inspector)).toBe(baselineClients + 2);

      await sleep(1_500);
      expect(await survivingRuntime.directory.connectionCount(crashOnlyUser)).toBe(1);
      expect(await survivingRuntime.directory.getLatestSocket(crashOnlyUser))
        .toBe(crashedSocket);
      expect(await survivingRuntime.directory.connectionCount(sharedUser)).toBe(2);
      expect(await survivingRuntime.directory.getLatestSocket(sharedUser))
        .toBe(crashedSharedSocket);

      const exactChildPid = child.pid;
      expect(exactChildPid).toBeTypeOf("number");
      const childExit = waitForChildExit(child);
      expect(child.kill("SIGKILL")).toBe(true);
      await childExit;
      await waitFor(async () => await clientCount(inspector) === baselineClients + 1);
      await waitFor(() => observedTransitions.some((transition) =>
        transition.userId === crashOnlyUser && transition.state === "offline"));

      expect(await survivingRuntime.directory.connectionCount(crashOnlyUser)).toBe(0);
      expect(await survivingRuntime.directory.getLatestSocket(crashOnlyUser))
        .toBeUndefined();
      expect(await survivingRuntime.directory.isOnline(crashOnlyUser)).toBe(false);
      expect(await survivingRuntime.directory.connectionCount(sharedUser)).toBe(1);
      expect(await survivingRuntime.directory.getLatestSocket(sharedUser))
        .toBe(survivorSocket);
      expect(await survivingRuntime.directory.isOnline(sharedUser)).toBe(true);
      expect(observedTransitions.some((transition) =>
        transition.userId === sharedUser && transition.state === "offline"))
        .toBe(false);

      const pendingBeforeFinalRemoval = await maintenance.listPendingPresence();
      expect(pendingBeforeFinalRemoval).toContainEqual(expect.objectContaining({
        userId: crashOnlyUser,
        state: "offline",
        sourceSocketId: crashedSocket,
      }));
      expect(pendingBeforeFinalRemoval).not.toContainEqual(expect.objectContaining({
        userId: sharedUser,
        state: "offline",
      }));

      const finalRemoval = await survivingRuntime.directory.remove(
        sharedUser,
        survivorSocket,
      );
      expect(finalRemoval).toEqual(expect.objectContaining({
        removed: true,
        lastConnection: true,
        presenceTransition: expect.objectContaining({
          userId: sharedUser,
          state: "offline",
          sourceSocketId: survivorSocket,
        }),
      }));

      console.log(JSON.stringify({
        phase: "2D-5-crash",
        crashedChildPid: exactChildPid,
        leaseTtlMilliseconds: LEASE_TTL_MS,
        crashOnlyCountAfterReap: 0,
        sharedCountAfterReap: 1,
        sharedLatestAfterReap: "survivor",
        finalOfflineTruth: true,
        redisClientsPerStateRuntime: 1,
      }));
    } finally {
      process.off("exit", killChildOnParentExit);
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await waitForChildExit(child).catch(() => undefined);
      }
      if (survivingRuntime) {
        survivingRuntime.markDraining();
        await survivingRuntime.close().catch(() => undefined);
      }
      if (inspectorRuntime.isReady) {
        await cleanupExactState(inspector, users, connections);
      }
      await inspectorRuntime.close();
    }
  }, 30_000);
});
