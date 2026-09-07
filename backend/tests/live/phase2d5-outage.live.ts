import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { connect as connectTcp, type Socket as TcpSocket } from "node:net";

import { Server as SocketServer, type Socket } from "socket.io";
import { afterAll, describe, expect, it, vi } from "vitest";

import { createApp } from "../../src/app.js";
import {
  createSocketConnectionStateRuntime,
  type SocketConnectionStateRuntime,
} from "../../src/infrastructure/redis/socket-connection-state.runtime.js";
import {
  prepareSocketTransport,
  type SocketTransportRuntime,
} from "../../src/infrastructure/redis/socket-io-redis-adapter.js";
import { createOriginPolicy } from "../../src/security/origin-policy.js";
import { Events } from "../../src/enums/event/event.enum.js";
import {
  enforceSocketEventLimits,
  SOCKET_EVENT_LIMITS,
} from "../../src/socket/socket-security.js";

const disposableAcknowledged =
  process.env.NEXUSCHAT_LIVE_REDIS_DISPOSABLE === "true";
const configuredServerPath = process.env.NEXUSCHAT_LIVE_REDIS_SERVER_PATH;

if (!disposableAcknowledged || !configuredServerPath) {
  throw new Error(
    "Live Redis outage tests require NEXUSCHAT_LIVE_REDIS_DISPOSABLE=true "
      + "and NEXUSCHAT_LIVE_REDIS_SERVER_PATH.",
  );
}

const redisServerPath = resolve(configuredServerPath);
if (!existsSync(redisServerPath)) {
  throw new Error("The configured disposable Redis server executable is missing.");
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds));

const waitFor = async (
  predicate: () => Promise<boolean> | boolean,
  timeoutMilliseconds = 8_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(25);
  }
  throw new Error("Timed out waiting for live Redis outage state.");
};

const availablePort = (): Promise<number> => new Promise((resolvePort, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    if (!address || typeof address === "string") {
      probe.close();
      reject(new Error("Unable to allocate a disposable Redis port."));
      return;
    }
    const port = address.port;
    probe.close((error) => error ? reject(error) : resolvePort(port));
  });
});

const pingRedis = (port: number): Promise<boolean> => new Promise((resolvePing) => {
  let socket: TcpSocket | undefined;
  const settle = (result: boolean) => {
    socket?.destroy();
    resolvePing(result);
  };
  socket = connectTcp({ host: "127.0.0.1", port });
  socket.setTimeout(300);
  socket.once("connect", () => socket?.write("*1\r\n$4\r\nPING\r\n"));
  socket.once("data", (data) => settle(data.toString().startsWith("+PONG")));
  socket.once("timeout", () => settle(false));
  socket.once("error", () => settle(false));
});

const waitForChildExit = (
  child: ChildProcess,
  timeoutMilliseconds = 5_000,
): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out stopping the disposable Redis process."));
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

type DisposableRedis = {
  readonly port: number;
  readonly url: string;
  readonly directory: string;
  currentProcess?: ChildProcess;
  start(): Promise<void>;
  stop(): Promise<void>;
  cleanup(): Promise<void>;
};

const createDisposableRedis = async (): Promise<DisposableRedis> => {
  const port = await availablePort();
  const directory = await mkdtemp(join(tmpdir(), "nexuschat-phase2d5-outage-"));
  const runtime: DisposableRedis = {
    port,
    url: `redis://127.0.0.1:${port}/0`,
    directory,
    currentProcess: undefined,
    start: async () => {
      if (runtime.currentProcess) {
        throw new Error("Disposable Redis is already running.");
      }
      const child = spawn(redisServerPath, [
        "--bind", "127.0.0.1",
        "--port", String(port),
        "--protected-mode", "yes",
        "--save", "",
        "--appendonly", "no",
        "--dir", directory,
        "--loglevel", "warning",
      ], {
        stdio: "ignore",
        windowsHide: true,
      });
      runtime.currentProcess = child;
      await waitFor(async () => {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error("Disposable Redis exited before becoming ready.");
        }
        return pingRedis(port);
      });
    },
    stop: async () => {
      const child = runtime.currentProcess;
      if (!child) return;
      child.kill();
      try {
        await waitForChildExit(child);
      } catch {
        child.kill("SIGKILL");
        await waitForChildExit(child);
      }
      runtime.currentProcess = undefined;
      await waitFor(async () => !await pingRedis(port));
    },
    cleanup: async () => {
      await runtime.stop();
      const resolvedDirectory = resolve(directory);
      const expectedPrefix = resolve(tmpdir(), "nexuschat-phase2d5-outage-");
      if (!resolvedDirectory.startsWith(expectedPrefix)) {
        throw new Error("Refusing to remove an unexpected Redis test directory.");
      }
      await rm(resolvedDirectory, { recursive: true, force: true });
    },
  };
  return runtime;
};

type LiveRuntime = {
  readonly httpServer: HttpServer;
  readonly io: SocketServer;
  readonly state: SocketConnectionStateRuntime;
  readonly transport: SocketTransportRuntime;
  readonly origin: string;
};

const listen = (server: HttpServer): Promise<number> =>
  new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to determine the live health port."));
        return;
      }
      resolvePort(address.port);
    });
  });

const createLiveRuntime = async (redisUrl: string): Promise<LiveRuntime> => {
  let state: SocketConnectionStateRuntime | undefined;
  let transport: SocketTransportRuntime | undefined;
  const originPolicy = createOriginPolicy({
    environment: "test",
    frontendOrigin: "http://127.0.0.1:3000",
  });
  const app = createApp({
    environment: "test",
    originPolicy,
    readiness: () => state?.isReady === true && transport?.isReady === true,
  });
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    transports: ["polling", "websocket"],
  });
  try {
    state = createSocketConnectionStateRuntime({
      mode: { kind: "distributed", redisUrl },
    });
    transport = await prepareSocketTransport({
      io,
      mode: { kind: "distributed", redisUrl },
    });
    await state.connect();
    await state.start({
      handleLostConnection: () => undefined,
      reconcilePresence: async () => undefined,
    });
    const port = await listen(httpServer);
    return {
      httpServer,
      io,
      state,
      transport,
      origin: `http://127.0.0.1:${port}`,
    };
  } catch (error) {
    state?.markDraining();
    await Promise.allSettled([
      new Promise<void>((resolveClose) => io.close(() => resolveClose())),
      state?.close(),
      transport?.close(),
    ].filter((operation): operation is Promise<void> => operation !== undefined));
    throw error;
  }
};

const closeLiveRuntime = async (runtime: LiveRuntime): Promise<void> => {
  runtime.state.markDraining();
  await new Promise<void>((resolveClose) => runtime.io.close(() => resolveClose()));
  await runtime.state.close();
  await runtime.transport.close();
};

const readHealth = async (origin: string) => {
  const response = await fetch(`${origin}/health`);
  return {
    status: response.status,
    body: await response.json() as unknown,
    cacheControl: response.headers.get("cache-control"),
  };
};

const ownedRedisProcesses = new Set<DisposableRedis>();

afterAll(async () => {
  for (const disposableRedis of ownedRedisProcesses) {
    await disposableRedis.cleanup();
  }
});

describe("Phase 2D-5 disposable Redis outage and reconnect", () => {
  it("fails closed while unavailable and recovers readiness without local fallback", async () => {
    const redis = await createDisposableRedis();
    ownedRedisProcesses.add(redis);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let runtimeA: LiveRuntime | undefined;
    let runtimeB: LiveRuntime | undefined;
    const preOutageUser = `phase2d5-pre-outage-${redis.port}`;
    const unavailableUser = `phase2d5-unavailable-${redis.port}`;
    const recoveredUser = `phase2d5-recovered-${redis.port}`;
    const policyKeyParts = [
      `phase2d5-outage-actor-${redis.port}`,
      `phase2d5-outage-resource-${redis.port}`,
    ];

    try {
      await redis.start();
      runtimeA = await createLiveRuntime(redis.url);
      runtimeB = await createLiveRuntime(redis.url);
      expect(runtimeA.state.mode).toBe("distributed");
      expect(runtimeB.state.mode).toBe("distributed");
      expect(await readHealth(runtimeA.origin)).toEqual({
        status: 200,
        body: { status: "ok" },
        cacheControl: "no-store",
      });
      expect(await readHealth(runtimeB.origin)).toEqual({
        status: 200,
        body: { status: "ok" },
        cacheControl: "no-store",
      });
      expect((await runtimeA.state.directory.add(
        preOutageUser,
        `pre-outage-socket-${redis.port}`,
      )).accepted).toBe(true);
      expect(await runtimeA.state.eventLimiter.consumeAll(
        [SOCKET_EVENT_LIMITS.pinMessage],
        policyKeyParts,
      )).toBe(true);

      await redis.stop();
      await waitFor(() => !runtimeA?.transport.isReady
        && !runtimeA?.state.isReady
        && !runtimeB?.transport.isReady
        && !runtimeB?.state.isReady);
      expect(await readHealth(runtimeA.origin)).toEqual({
        status: 503,
        body: { status: "unavailable" },
        cacheControl: "no-store",
      });
      expect(await readHealth(runtimeB.origin)).toEqual({
        status: 503,
        body: { status: "unavailable" },
        cacheControl: "no-store",
      });

      const emitted = vi.fn();
      const allowed = await enforceSocketEventLimits({
        socket: { emit: emitted } as unknown as Socket,
        event: "phase2d5:outage:limited",
        limiter: runtimeA.state.eventLimiter,
        policies: [SOCKET_EVENT_LIMITS.pinMessage],
        keyParts: policyKeyParts,
      });
      expect(allowed).toBe(false);
      expect(emitted).toHaveBeenCalledWith(Events.SECURITY_ERROR, {
        category: "RATE_LIMITED",
        event: "phase2d5:outage:limited",
      });

      let unavailableAdmission:
        | { status: "accepted"; accepted: boolean }
        | { status: "rejected" }
        | undefined;
      const unavailableAdmissionPromise = runtimeA.state.directory.add(
        unavailableUser,
        `unavailable-socket-${redis.port}`,
      ).then(
        (registration) => {
          unavailableAdmission = {
            status: "accepted",
            accepted: registration.accepted,
          };
          return registration;
        },
        (error: unknown) => {
          unavailableAdmission = { status: "rejected" };
          throw error;
        },
      );
      void unavailableAdmissionPromise.catch(() => undefined);
      await waitFor(() => unavailableAdmission?.status === "rejected", 1_000);
      expect(unavailableAdmission).toEqual({ status: "rejected" });

      await redis.start();
      await waitFor(() => runtimeA?.transport.isReady
        && runtimeA?.state.isReady
        && runtimeB?.transport.isReady
        && runtimeB?.state.isReady);
      expect(await readHealth(runtimeA.origin)).toEqual({
        status: 200,
        body: { status: "ok" },
        cacheControl: "no-store",
      });
      expect(await readHealth(runtimeB.origin)).toEqual({
        status: 200,
        body: { status: "ok" },
        cacheControl: "no-store",
      });
      expect(await runtimeA.state.directory.connectionCount(preOutageUser)).toBe(0);

      const recoveredTransportEvent = `phase2d5:recovered:${redis.port}`;
      const recoveredTransportDelivery = new Promise<unknown>((resolveDelivery) => {
        runtimeB?.io.once(recoveredTransportEvent, resolveDelivery);
      });
      runtimeA.io.serverSideEmit(recoveredTransportEvent, { recovered: true });
      await expect(Promise.race([
        recoveredTransportDelivery,
        sleep(2_000).then(() => {
          throw new Error("Recovered Socket.IO transport did not deliver.");
        }),
      ])).resolves.toEqual({ recovered: true });

      const recoveredSocket = `recovered-socket-${redis.port}`;
      expect((await runtimeA.state.directory.add(
        recoveredUser,
        recoveredSocket,
      )).accepted).toBe(true);
      expect(await runtimeA.state.eventLimiter.consumeAll(
        [SOCKET_EVENT_LIMITS.pinMessage],
        policyKeyParts,
      )).toBe(true);

      await runtimeA.state.directory.remove(
        preOutageUser,
        `pre-outage-socket-${redis.port}`,
      );
      await runtimeA.state.directory.remove(
        unavailableUser,
        `unavailable-socket-${redis.port}`,
      );
      await runtimeA.state.directory.remove(recoveredUser, recoveredSocket);

      const serializedLogs = JSON.stringify(errorLog.mock.calls);
      expect(serializedLogs).toContain("Redis client error.");
      expect(serializedLogs).toContain("Socket rate-limit evaluation failed.");
      expect(serializedLogs).not.toContain(redis.url);
      expect(serializedLogs).not.toContain(redisServerPath);

      console.log(JSON.stringify({
        phase: "2D-5-outage",
        healthPorts: [
          Number(new URL(runtimeA.origin).port),
          Number(new URL(runtimeB.origin).port),
        ],
        redisPort: redis.port,
        healthDuringOutage: 503,
        noLocalRateLimitFallback: true,
        outageAdmissionBeforeRecovery: "rejected",
        recovered: true,
        crossNodeTransportRecovered: true,
        redisDataSurvivedRestart: false,
      }));
    } finally {
      errorLog.mockRestore();
      if (!await pingRedis(redis.port)) {
        await redis.start().catch(() => undefined);
      }
      await Promise.allSettled([
        ...(runtimeA ? [closeLiveRuntime(runtimeA)] : []),
        ...(runtimeB ? [closeLiveRuntime(runtimeB)] : []),
      ]);
      await redis.cleanup();
      ownedRedisProcesses.delete(redis);
    }
  }, 40_000);
});
