import { EventEmitter } from "node:events";
import { Server as HttpServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  disconnectPrisma: vi.fn(async () => undefined),
  initializeProviders: vi.fn(),
  registerSocketHandlers: vi.fn(),
  route: vi.fn((_request, _response, next) => next()),
  socketAuthenticator: vi.fn((_socket, next) => next()),
  createSocketAuthenticatorMiddleware: vi.fn(),
  runtimeConfig: {
    app: {
      environment: "test",
      port: "4000",
      clientUrl: "http://localhost:3000",
      serverUrl: "http://localhost:4000",
    },
    redis: { url: undefined },
  },
}));

vi.mock("../src/config/env.config.js", () => ({ config: mocks.runtimeConfig }));
vi.mock("../src/config/providers.config.js", () => ({
  initializeProviders: mocks.initializeProviders,
}));
vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: { $disconnect: mocks.disconnectPrisma },
}));
vi.mock("../src/middlewares/socket-auth.middleware.js", () => ({
  createSocketAuthenticatorMiddleware: mocks.createSocketAuthenticatorMiddleware
    .mockReturnValue(mocks.socketAuthenticator),
}));
vi.mock("../src/socket/socket.js", () => ({ default: mocks.registerSocketHandlers }));
vi.mock("../src/routes/attachment.router.js", () => ({ default: mocks.route }));
vi.mock("../src/routes/auth.router.js", () => ({ default: mocks.route }));
vi.mock("../src/routes/chat.router.js", () => ({ default: mocks.route }));
vi.mock("../src/routes/message.router.js", () => ({ default: mocks.route }));
vi.mock("../src/routes/request.router.js", () => ({ default: mocks.route }));
vi.mock("../src/routes/user.router.js", () => ({ default: mocks.route }));

import type {
  BackendServer,
  CreateBackendServerOptions,
} from "../src/bootstrap/create-server.js";
import type {
  SocketConnectionMaintenanceCallbacks,
  SocketConnectionStateRuntime,
} from "../src/infrastructure/redis/socket-connection-state.runtime.js";
import type { SocketConnectionDirectory } from "../src/socket/connection-directory.js";
import type { SocketHandlerLifecycle } from "../src/socket/socket.js";
import { createCapturingLogger } from "./support/capturing-logger.js";

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const createFakeDirectory = (): SocketConnectionDirectory => ({
  add: vi.fn(async () => ({
    accepted: true,
    firstConnection: true,
    presenceTransition: undefined,
  })),
  remove: vi.fn(async () => ({
    removed: true,
    lastConnection: true,
    presenceTransition: undefined,
  })),
  getSockets: vi.fn(async () => []),
  getLatestSocket: vi.fn(async () => undefined),
  isOnline: vi.fn(async () => false),
  connectionCount: vi.fn(async () => 0),
  onlineUserIds: vi.fn(async () => []),
});

const createFakeConnectionState = ({
  mode = "local",
  connect,
  start,
  close,
}: {
  mode?: "local" | "distributed";
  connect?: () => Promise<void>;
  start?: (callbacks: SocketConnectionMaintenanceCallbacks) => Promise<void>;
  close?: () => Promise<void>;
} = {}) => {
  let ready = false;
  let operational = false;
  const directory = createFakeDirectory();
  const eventLimiter = {
    consume: vi.fn(async () => true),
    consumeAll: vi.fn(async () => true),
  };
  const runtime: SocketConnectionStateRuntime = {
    mode,
    directory,
    eventLimiter,
    maintenance: undefined,
    get isReady() {
      return ready;
    },
    get isOperational() {
      return operational;
    },
    connect: vi.fn(async () => {
      await connect?.();
    }),
    start: vi.fn(async (callbacks: SocketConnectionMaintenanceCallbacks) => {
      await start?.(callbacks);
      ready = true;
      operational = true;
    }),
    markDraining: vi.fn(() => {
      ready = false;
      operational = false;
    }),
    close: vi.fn(async () => {
      ready = false;
      operational = false;
      await close?.();
    }),
  };

  return {
    directory,
    eventLimiter,
    runtime,
    setReady(nextReady: boolean) {
      ready = nextReady;
      operational = nextReady;
    },
  };
};

const createFakeSocketLifecycle = () => {
  let acceptingConnections = true;
  const lifecycle: SocketHandlerLifecycle = {
    get isAcceptingConnections() {
      return acceptingConnections;
    },
    beginDrain: vi.fn(() => {
      acceptingConnections = false;
    }),
    disconnectLocalSockets: vi.fn(),
    drain: vi.fn(async () => undefined),
    reconcilePresence: vi.fn(async () => undefined),
    handleLostConnection: vi.fn(),
  };

  return {
    lifecycle,
    setAcceptingConnections(nextValue: boolean) {
      acceptingConnections = nextValue;
    },
  };
};

const createFakeRuntime = ({
  listenError,
  connectionState = createFakeConnectionState().runtime,
  socketLifecycle = createFakeSocketLifecycle().lifecycle,
}: {
  listenError?: Error;
  connectionState?: SocketConnectionStateRuntime;
  socketLifecycle?: SocketHandlerLifecycle;
} = {}) => {
  const httpServer = new EventEmitter() as EventEmitter & {
    close: ReturnType<typeof vi.fn>;
    listen: ReturnType<typeof vi.fn>;
  };
  const io = {
    close: vi.fn((callback?: (error?: Error) => void) => {
      callback?.();
      return io;
    }),
  };
  httpServer.listen = vi.fn(() => {
    queueMicrotask(() => httpServer.emit(listenError ? "error" : "listening", listenError));
    return httpServer;
  });
  httpServer.close = vi.fn((callback: (error?: Error) => void) => {
    callback();
    return httpServer;
  });

  const presence = {
    reconcileTransition: vi.fn(async () => undefined),
    reconcileUser: vi.fn(async () => undefined),
    reconcilePending: vi.fn(async () => 0),
    drain: vi.fn(async () => undefined),
  };

  return {
    httpServer,
    io,
    runtime: {
      app: vi.fn(),
      httpServer,
      io,
      connectionState,
      presence,
      socketLifecycle,
    } as unknown as BackendServer,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("backend server construction", () => {
  it("imports reusable construction without binding a listener", async () => {
    vi.resetModules();
    const listenSpy = vi.spyOn(HttpServer.prototype, "listen");

    await import("../src/bootstrap/create-server.js");

    expect(listenSpy).not.toHaveBeenCalled();
    expect(mocks.initializeProviders).not.toHaveBeenCalled();
    listenSpy.mockRestore();
  }, 30_000);

  it("wires the selected directory into Express and Socket handlers without listening", async () => {
    const { createBackendServer } = await import("../src/bootstrap/create-server.js");
    const useSpy = vi.spyOn(SocketServer.prototype, "use");
    const state = createFakeConnectionState();
    const socketLifecycle = createFakeSocketLifecycle().lifecycle;
    mocks.registerSocketHandlers.mockReturnValueOnce(socketLifecycle);

    const runtime = createBackendServer({ connectionState: state.runtime });

    expect(runtime.app).toBeTypeOf("function");
    expect(runtime.httpServer).toBeInstanceOf(HttpServer);
    expect(runtime.httpServer.listening).toBe(false);
    expect(runtime.io).toBeDefined();
    expect(runtime.connectionState).toBe(state.runtime);
    expect(runtime.app.get("connectionDirectory")).toBe(state.directory);
    expect(mocks.initializeProviders).toHaveBeenCalledWith(
      mocks.runtimeConfig,
      expect.objectContaining({ component: "provider" }),
    );
    expect(mocks.initializeProviders.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.registerSocketHandlers.mock.invocationCallOrder[0],
    );
    expect(mocks.createSocketAuthenticatorMiddleware).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ component: "auth" }),
    );
    expect(useSpy).toHaveBeenCalledWith(mocks.socketAuthenticator);
    expect(mocks.registerSocketHandlers).toHaveBeenCalledWith(runtime.io, {
      directory: state.directory,
      limiter: state.eventLimiter,
      presence: runtime.presence,
      logger: expect.objectContaining({ component: "socket" }),
    });
    expect(runtime.socketLifecycle).toBe(socketLifecycle);
    expect(state.runtime.connect).not.toHaveBeenCalled();
    expect(state.runtime.start).not.toHaveBeenCalled();
    await runtime.io.close();
    useSpy.mockRestore();
  });
});

describe("backend startup", () => {
  it("selects local state without Redis configuration and readies it before listening", async () => {
    const { startServer } = await import("../src/bootstrap/start-server.js");
    const state = createFakeConnectionState({ mode: "local" });
    const lifecycle = createFakeSocketLifecycle();
    const fake = createFakeRuntime({
      connectionState: state.runtime,
      socketLifecycle: lifecycle.lifecycle,
    });
    let readiness: (() => boolean) | undefined;
    const transport = {
      mode: "local" as const,
      isReady: true,
      close: vi.fn(async () => undefined),
    };
    const createConnectionState = vi.fn(() => state.runtime);
    const processLogger = createCapturingLogger("bootstrap");
    const createLogger = vi.fn(() => processLogger);
    const createServer = vi.fn((options?: CreateBackendServerOptions) => {
      readiness = options?.readiness;
      expect(options?.connectionState).toBe(state.runtime);
      expect(readiness?.()).toBe(false);
      return fake.runtime;
    });
    const prepareTransport = vi.fn(async ({ mode }) => {
      expect(mode).toEqual({ kind: "local" });
      expect(fake.httpServer.listen).not.toHaveBeenCalled();
      return transport;
    });

    const started = await startServer({
      createServer,
      createConnectionState,
      environment: "development",
      redisUrl: undefined,
      prepareTransport,
      registerHandlers: vi.fn(() => vi.fn()),
      logStarted: vi.fn(),
      disconnectPrisma: vi.fn(async () => undefined),
      createLogger,
    });

    expect(createLogger).toHaveBeenCalledOnce();
    expect(createLogger).toHaveBeenCalledWith({
      environment: "development",
      runtimeMode: "local",
    });
    expect(started.logger).toBe(processLogger);
    expect(createConnectionState).toHaveBeenCalledOnce();
    expect(createConnectionState).toHaveBeenCalledWith({
      mode: { kind: "local" },
      logger: processLogger,
    });
    expect(state.runtime.connect).toHaveBeenCalledOnce();
    expect(state.runtime.start).toHaveBeenCalledOnce();
    expect(state.runtime.start.mock.invocationCallOrder[0]).toBeLessThan(
      fake.httpServer.listen.mock.invocationCallOrder[0],
    );
    expect(readiness?.()).toBe(true);
    await started.shutdown();
  });

  it("prepares transport, connects and starts distributed state before listening with dynamic readiness", async () => {
    const { startServer } = await import("../src/bootstrap/start-server.js");
    let readiness: (() => boolean) | undefined;
    let fake!: ReturnType<typeof createFakeRuntime>;
    const state = createFakeConnectionState({
      mode: "distributed",
      connect: async () => {
        expect(readiness?.()).toBe(false);
        expect(fake.httpServer.listen).not.toHaveBeenCalled();
      },
      start: async () => {
        expect(readiness?.()).toBe(false);
        expect(fake.httpServer.listen).not.toHaveBeenCalled();
      },
    });
    const lifecycle = createFakeSocketLifecycle();
    fake = createFakeRuntime({
      connectionState: state.runtime,
      socketLifecycle: lifecycle.lifecycle,
    });
    let transportReady = false;
    const transport = {
      mode: "distributed" as const,
      get isReady() {
        return transportReady;
      },
      close: vi.fn(async () => undefined),
    };
    const createServer = vi.fn((options?: CreateBackendServerOptions) => {
      readiness = options?.readiness;
      expect(options?.connectionState).toBe(state.runtime);
      return fake.runtime;
    });
    const prepareTransport = vi.fn(async () => {
      expect(readiness?.()).toBe(false);
      expect(state.runtime.connect).not.toHaveBeenCalled();
      expect(fake.httpServer.listen).not.toHaveBeenCalled();
      transportReady = true;
      return transport;
    });

    const started = await startServer({
      createServer,
      createConnectionState: vi.fn(() => state.runtime),
      environment: "development",
      redisUrl: "rediss://redis.example.test:6380",
      prepareTransport,
      registerHandlers: vi.fn(() => vi.fn()),
      logStarted: vi.fn(),
      disconnectPrisma: vi.fn(async () => undefined),
    });

    expect(prepareTransport).toHaveBeenCalledWith({
      io: fake.runtime.io,
      logger: expect.objectContaining({ component: "bootstrap" }),
      mode: {
        kind: "distributed",
        redisUrl: "rediss://redis.example.test:6380",
      },
    });
    expect(prepareTransport.mock.invocationCallOrder[0]).toBeLessThan(
      state.runtime.connect.mock.invocationCallOrder[0],
    );
    expect(state.runtime.connect.mock.invocationCallOrder[0]).toBeLessThan(
      state.runtime.start.mock.invocationCallOrder[0],
    );
    expect(state.runtime.start.mock.invocationCallOrder[0]).toBeLessThan(
      fake.httpServer.listen.mock.invocationCallOrder[0],
    );
    expect(readiness?.()).toBe(true);

    transportReady = false;
    expect(readiness?.()).toBe(false);
    transportReady = true;
    state.setReady(false);
    expect(readiness?.()).toBe(false);
    state.setReady(true);
    lifecycle.setAcceptingConnections(false);
    expect(readiness?.()).toBe(false);
    lifecycle.setAcceptingConnections(true);
    expect(readiness?.()).toBe(true);
    await started.shutdown();
    expect(readiness?.()).toBe(false);
  });

  it("rejects production without REDIS_URL before constructing state, server, or transport", async () => {
    const { startServer } = await import("../src/bootstrap/start-server.js");
    const createConnectionState = vi.fn();
    const createServer = vi.fn();
    const prepareTransport = vi.fn();

    await expect(startServer({
      createConnectionState,
      createServer,
      environment: "production",
      redisUrl: undefined,
      prepareTransport,
    })).rejects.toMatchObject({
      code: "DISTRIBUTED_REALTIME_CONFIGURATION_INVALID",
      statusCode: 500,
    });

    expect(createConnectionState).not.toHaveBeenCalled();
    expect(createServer).not.toHaveBeenCalled();
    expect(prepareTransport).not.toHaveBeenCalled();
  });

  it("cleans connection state and constructed resources when transport preparation fails", async () => {
    const { startServer } = await import("../src/bootstrap/start-server.js");
    const state = createFakeConnectionState({ mode: "distributed" });
    const lifecycle = createFakeSocketLifecycle();
    const fake = createFakeRuntime({
      connectionState: state.runtime,
      socketLifecycle: lifecycle.lifecycle,
    });
    const preparationError = new Error("private Redis startup failure");
    const disconnectPrisma = vi.fn(async () => undefined);
    const registerHandlers = vi.fn();

    await expect(startServer({
      createConnectionState: vi.fn(() => state.runtime),
      createServer: () => fake.runtime,
      environment: "development",
      redisUrl: "rediss://redis.example.test:6380",
      prepareTransport: vi.fn().mockRejectedValue(preparationError),
      disconnectPrisma,
      registerHandlers,
      logStarted: vi.fn(),
    })).rejects.toBe(preparationError);

    expect(fake.httpServer.listen).not.toHaveBeenCalled();
    expect(state.runtime.connect).not.toHaveBeenCalled();
    expect(registerHandlers).not.toHaveBeenCalled();
    expect(lifecycle.lifecycle.beginDrain).toHaveBeenCalledOnce();
    expect(lifecycle.lifecycle.disconnectLocalSockets).toHaveBeenCalledOnce();
    expect(lifecycle.lifecycle.drain).toHaveBeenCalledTimes(2);
    expect(state.runtime.close).toHaveBeenCalledOnce();
    expect(fake.io.close).toHaveBeenCalledOnce();
    expect(fake.httpServer.close).toHaveBeenCalledOnce();
    expect(disconnectPrisma).toHaveBeenCalledOnce();
  });

  it.each(["connect", "start"] as const)(
    "prevents listen and attempts full cleanup when distributed state %s fails",
    async (failurePoint) => {
      const { startServer } = await import("../src/bootstrap/start-server.js");
      const startupError = new Error(`private state ${failurePoint} failure`);
      const state = createFakeConnectionState({
        mode: "distributed",
        connect: failurePoint === "connect"
          ? async () => { throw startupError; }
          : undefined,
        start: failurePoint === "start"
          ? async () => { throw startupError; }
          : undefined,
      });
      const lifecycle = createFakeSocketLifecycle();
      const fake = createFakeRuntime({
        connectionState: state.runtime,
        socketLifecycle: lifecycle.lifecycle,
      });
      const closeTransport = vi.fn(async () => undefined);
      const disconnectPrisma = vi.fn(async () => undefined);

      await expect(startServer({
        createConnectionState: vi.fn(() => state.runtime),
        createServer: () => fake.runtime,
        environment: "development",
        redisUrl: "rediss://redis.example.test:6380",
        prepareTransport: vi.fn(async () => ({
          mode: "distributed" as const,
          isReady: true,
          close: closeTransport,
        })),
        disconnectPrisma,
        registerHandlers: vi.fn(),
        logStarted: vi.fn(),
      })).rejects.toBe(startupError);

      expect(fake.httpServer.listen).not.toHaveBeenCalled();
      expect(state.runtime.connect).toHaveBeenCalledOnce();
      expect(state.runtime.start).toHaveBeenCalledTimes(failurePoint === "start" ? 1 : 0);
      expect(lifecycle.lifecycle.beginDrain).toHaveBeenCalledOnce();
      expect(lifecycle.lifecycle.disconnectLocalSockets).toHaveBeenCalledOnce();
      expect(lifecycle.lifecycle.drain).toHaveBeenCalledTimes(2);
      expect(state.runtime.close).toHaveBeenCalledOnce();
      expect(fake.io.close).toHaveBeenCalledOnce();
      expect(closeTransport).toHaveBeenCalledOnce();
      expect(fake.httpServer.close).toHaveBeenCalledOnce();
      expect(disconnectPrisma).toHaveBeenCalledOnce();
    },
  );

  it("listens exactly once and returns an explicit shutdown handle", async () => {
    const { startServer } = await import("../src/bootstrap/start-server.js");
    const state = createFakeConnectionState();
    const lifecycle = createFakeSocketLifecycle();
    const fake = createFakeRuntime({
      connectionState: state.runtime,
      socketLifecycle: lifecycle.lifecycle,
    });
    const unregisterHandlers = vi.fn();
    const registerHandlers = vi.fn(() => unregisterHandlers);
    const disconnectPrisma = vi.fn(async () => undefined);
    const logStarted = vi.fn();

    const started = await startServer({
      createConnectionState: vi.fn(() => state.runtime),
      createServer: () => fake.runtime,
      port: 4321,
      prepareTransport: vi.fn(async () => ({
        mode: "local" as const,
        isReady: true,
        close: vi.fn(async () => undefined),
      })),
      disconnectPrisma,
      registerHandlers,
      logStarted,
    });

    expect(fake.httpServer.listen).toHaveBeenCalledOnce();
    expect(fake.httpServer.listen).toHaveBeenCalledWith(4321);
    expect(registerHandlers).toHaveBeenCalledOnce();
    expect(logStarted).toHaveBeenCalledWith(4321);

    await started.shutdown();
    expect(unregisterHandlers).toHaveBeenCalledOnce();
    expect(state.runtime.close).toHaveBeenCalledOnce();
    expect(fake.io.close).toHaveBeenCalledOnce();
    expect(fake.httpServer.close).toHaveBeenCalledOnce();
    expect(disconnectPrisma).toHaveBeenCalledOnce();
  });

  it("surfaces listener errors after attempting every constructed-resource cleanup", async () => {
    const { startServer } = await import("../src/bootstrap/start-server.js");
    const state = createFakeConnectionState({ mode: "distributed" });
    const lifecycle = createFakeSocketLifecycle();
    const listenerError = new Error("private listener configuration");
    const fake = createFakeRuntime({
      listenError: listenerError,
      connectionState: state.runtime,
      socketLifecycle: lifecycle.lifecycle,
    });
    const unregisterHandlers = vi.fn();
    const disconnectPrisma = vi.fn(async () => undefined);
    const logStarted = vi.fn();
    const closeTransport = vi.fn(async () => {
      throw new Error("rediss://redis-user:private-listen-cleanup@redis.example.test");
    });
    const logger = createCapturingLogger("bootstrap");

    await expect(startServer({
      createConnectionState: vi.fn(() => state.runtime),
      createServer: () => fake.runtime,
      environment: "development",
      redisUrl: "rediss://redis.example.test:6380",
      prepareTransport: vi.fn(async () => ({
        mode: "distributed" as const,
        isReady: true,
        close: closeTransport,
      })),
      disconnectPrisma,
      registerHandlers: vi.fn(() => unregisterHandlers),
      logStarted,
      createLogger: vi.fn(() => logger),
    })).rejects.toBe(listenerError);

    expect(unregisterHandlers).toHaveBeenCalledOnce();
    expect(lifecycle.lifecycle.drain).toHaveBeenCalledTimes(2);
    expect(state.runtime.close).toHaveBeenCalledOnce();
    expect(fake.io.close).toHaveBeenCalledOnce();
    expect(closeTransport).toHaveBeenCalledOnce();
    expect(fake.httpServer.close).toHaveBeenCalledOnce();
    expect(disconnectPrisma).toHaveBeenCalledOnce();
    expect(logStarted).not.toHaveBeenCalled();
    const output = JSON.stringify(logger.events);
    expect(output).toContain("distributed_realtime_shutdown_failed");
    expect(output).not.toContain("private-listen-cleanup");
  });

  it("sanitizes startup failures and sets a non-zero process outcome", async () => {
    const { main } = await import("../src/bootstrap/main.js");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const setExitCode = vi.fn();

    await main({
      start: vi.fn().mockRejectedValue(new Error("database-password=private")),
      setExitCode,
    });

    expect(setExitCode).toHaveBeenCalledWith(1);
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain("Backend startup failed.");
    expect(logged).toContain("errorType");
    expect(logged).not.toContain("database-password=private");
    errorSpy.mockRestore();
  });
});

describe("coordinated shutdown", () => {
  it("stops HTTP admission early and keeps state available through both Socket cleanup drains", async () => {
    const { createShutdownCoordinator } = await import("../src/bootstrap/shutdown.js");
    const fake = createFakeRuntime();
    const beginSocketDrain = vi.fn();
    const disconnectLocalSockets = vi.fn();
    const drainSocketOperations = vi.fn(async () => undefined);
    const closeConnectionState = vi.fn(async () => undefined);
    const closeDistributedRealtime = vi.fn(async () => undefined);
    const disconnectPrisma = vi.fn(async () => undefined);
    const shutdown = createShutdownCoordinator({
      httpServer: fake.runtime.httpServer,
      io: fake.runtime.io,
      beginSocketDrain,
      disconnectLocalSockets,
      drainSocketOperations,
      closeConnectionState,
      closeDistributedRealtime,
      disconnectPrisma,
    });

    await Promise.all([shutdown(), shutdown(), shutdown()]);

    for (const operation of [
      beginSocketDrain,
      fake.httpServer.close,
      disconnectLocalSockets,
      fake.io.close,
      closeConnectionState,
      closeDistributedRealtime,
      disconnectPrisma,
    ]) {
      expect(operation).toHaveBeenCalledOnce();
    }
    expect(drainSocketOperations).toHaveBeenCalledTimes(2);

    const orderedCalls = [
      beginSocketDrain.mock.invocationCallOrder[0]!,
      fake.httpServer.close.mock.invocationCallOrder[0]!,
      disconnectLocalSockets.mock.invocationCallOrder[0]!,
      drainSocketOperations.mock.invocationCallOrder[0]!,
      fake.io.close.mock.invocationCallOrder[0]!,
      drainSocketOperations.mock.invocationCallOrder[1]!,
      closeConnectionState.mock.invocationCallOrder[0]!,
      closeDistributedRealtime.mock.invocationCallOrder[0]!,
      disconnectPrisma.mock.invocationCallOrder[0]!,
    ];
    for (let index = 1; index < orderedCalls.length; index += 1) {
      expect(orderedCalls[index - 1]).toBeLessThan(orderedCalls[index]);
    }
  });

  it("waits for pending asynchronous disconnect cleanup before closing Socket.IO or connection state", async () => {
    const { createShutdownCoordinator } = await import("../src/bootstrap/shutdown.js");
    const fake = createFakeRuntime();
    const disconnectCleanup = createDeferred();
    const disconnectLocalSockets = vi.fn();
    const drainSocketOperations = vi.fn()
      .mockImplementationOnce(() => disconnectCleanup.promise)
      .mockResolvedValueOnce(undefined);
    const closeConnectionState = vi.fn(async () => undefined);
    const closeDistributedRealtime = vi.fn(async () => undefined);
    const shutdown = createShutdownCoordinator({
      httpServer: fake.runtime.httpServer,
      io: fake.runtime.io,
      disconnectLocalSockets,
      drainSocketOperations,
      closeConnectionState,
      closeDistributedRealtime,
      disconnectPrisma: vi.fn(async () => undefined),
    });

    const shutdownPromise = shutdown();
    await vi.waitFor(() => expect(drainSocketOperations).toHaveBeenCalledOnce());
    expect(disconnectLocalSockets).toHaveBeenCalledOnce();
    expect(closeConnectionState).not.toHaveBeenCalled();
    expect(fake.io.close).not.toHaveBeenCalled();
    expect(closeDistributedRealtime).not.toHaveBeenCalled();

    disconnectCleanup.resolve();
    await shutdownPromise;

    expect(closeConnectionState).toHaveBeenCalledOnce();
    expect(fake.io.close).toHaveBeenCalledOnce();
    expect(drainSocketOperations).toHaveBeenCalledTimes(2);
    expect(drainSocketOperations.mock.invocationCallOrder[1]).toBeLessThan(
      closeConnectionState.mock.invocationCallOrder[0]!,
    );
    expect(closeDistributedRealtime).toHaveBeenCalledOnce();
  });

  it("waits for in-flight HTTP work before closing Socket.IO, state, or Prisma", async () => {
    const { createShutdownCoordinator } = await import("../src/bootstrap/shutdown.js");
    const fake = createFakeRuntime();
    const httpCompletion = createDeferred();
    fake.httpServer.close.mockImplementationOnce((callback: (error?: Error) => void) => {
      void httpCompletion.promise.then(() => callback());
      return fake.httpServer;
    });
    const closeConnectionState = vi.fn(async () => undefined);
    const disconnectPrisma = vi.fn(async () => undefined);
    const shutdown = createShutdownCoordinator({
      httpServer: fake.runtime.httpServer,
      io: fake.runtime.io,
      drainSocketOperations: vi.fn(async () => undefined),
      closeConnectionState,
      disconnectPrisma,
    });

    const shutdownPromise = shutdown();
    await vi.waitFor(() => expect(fake.httpServer.close).toHaveBeenCalledOnce());
    expect(fake.io.close).not.toHaveBeenCalled();
    expect(closeConnectionState).not.toHaveBeenCalled();
    expect(disconnectPrisma).not.toHaveBeenCalled();

    httpCompletion.resolve();
    await shutdownPromise;

    expect(fake.io.close).toHaveBeenCalledOnce();
    expect(closeConnectionState).toHaveBeenCalledOnce();
    expect(disconnectPrisma).toHaveBeenCalledOnce();
  });

  it.each([
    ["Socket operation drain failed.", "drain"],
    ["HTTP server shutdown failed.", "http"],
    ["Connection state shutdown failed.", "state"],
  ] as const)(
    "bounds a never-settling %s stage, attempts later resources, and rejects safely",
    async (expectedContext, stalledStage) => {
      const { createShutdownCoordinator } = await import("../src/bootstrap/shutdown.js");
      const fake = createFakeRuntime();
      const neverSettles = new Promise<void>(() => undefined);
      const drainSocketOperations = vi.fn(async () => undefined);
      const closeConnectionState = vi.fn(async () => undefined);
      const closeDistributedRealtime = vi.fn(async () => undefined);
      const disconnectPrisma = vi.fn(async () => undefined);
      if (stalledStage === "drain") {
        drainSocketOperations.mockImplementation(() => neverSettles);
      }
      if (stalledStage === "http") {
        fake.httpServer.close.mockImplementationOnce(() => fake.httpServer);
      }
      if (stalledStage === "state") {
        closeConnectionState.mockImplementation(() => neverSettles);
      }
      const logger = createCapturingLogger("bootstrap");
      const shutdown = createShutdownCoordinator({
        httpServer: fake.runtime.httpServer,
        io: fake.runtime.io,
        drainSocketOperations,
        closeConnectionState,
        closeDistributedRealtime,
        disconnectPrisma,
        stageTimeoutMs: 10,
        logger,
      });

      await expect(shutdown()).rejects.toThrow(/^Backend shutdown failed$/);

      expect(fake.httpServer.close).toHaveBeenCalledOnce();
      expect(fake.io.close).toHaveBeenCalledOnce();
      expect(drainSocketOperations).toHaveBeenCalledTimes(2);
      expect(closeConnectionState).toHaveBeenCalledOnce();
      expect(closeDistributedRealtime).toHaveBeenCalledOnce();
      expect(disconnectPrisma).toHaveBeenCalledOnce();
      const logged = JSON.stringify(logger.events);
      expect(logged).toContain(
        expectedContext.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      );
      expect(logged).not.toContain("Shutdown stage timed out.");
    },
  );

  it("attempts every shutdown stage and sanitizes individual failures", async () => {
    const { createShutdownCoordinator } = await import("../src/bootstrap/shutdown.js");
    const fake = createFakeRuntime();
    const beginSocketDrain = vi.fn(() => { throw new Error("private-admission-detail"); });
    const disconnectLocalSockets = vi.fn(() => { throw new Error("private-local-disconnect-detail"); });
    const drainSocketOperations = vi.fn(async () => { throw new Error("private-operation-drain-detail"); });
    const closeConnectionState = vi.fn(async () => {
      throw new Error("rediss://state-user:private-state-password@redis.example.test");
    });
    const closeDistributedRealtime = vi.fn(async () => {
      throw new Error("rediss://redis-user:private-transport-password@redis.example.test");
    });
    const disconnectPrisma = vi.fn(async () => { throw new Error("private-database-detail"); });
    const logger = createCapturingLogger("bootstrap");
    fake.io.close.mockImplementationOnce(() => { throw new Error("private-socket-detail"); });
    fake.httpServer.close.mockImplementationOnce((callback: (error?: Error) => void) => {
      callback(new Error("private-http-detail"));
      return fake.httpServer;
    });
    const shutdown = createShutdownCoordinator({
      httpServer: fake.runtime.httpServer,
      io: fake.runtime.io,
      beginSocketDrain,
      disconnectLocalSockets,
      drainSocketOperations,
      closeConnectionState,
      closeDistributedRealtime,
      disconnectPrisma,
      logger,
    });

    await expect(shutdown()).rejects.toThrow("Backend shutdown failed");

    for (const operation of [
      beginSocketDrain,
      disconnectLocalSockets,
      closeConnectionState,
      fake.io.close,
      closeDistributedRealtime,
      fake.httpServer.close,
      disconnectPrisma,
    ]) {
      expect(operation).toHaveBeenCalledOnce();
    }
    expect(drainSocketOperations).toHaveBeenCalledTimes(2);
    const logged = JSON.stringify(logger.events);
    for (const context of [
      "Socket admission drain failed.",
      "Local Socket disconnect failed.",
      "Socket operation drain failed.",
      "Socket operation drain after Socket.IO shutdown failed.",
      "Connection state shutdown failed.",
      "Socket.IO shutdown failed.",
      "Distributed realtime shutdown failed.",
      "HTTP server shutdown failed.",
      "Prisma shutdown failed.",
    ]) {
      expect(logged).toContain(
        context.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      );
    }
    for (const secret of [
      "private-admission-detail",
      "private-local-disconnect-detail",
      "private-operation-drain-detail",
      "private-state-password",
      "private-socket-detail",
      "private-transport-password",
      "private-http-detail",
      "private-database-detail",
    ]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("handles repeated signals with one shutdown and one process exit", async () => {
    const { registerProcessHandlers } = await import("../src/bootstrap/shutdown.js");
    const processTarget = new EventEmitter();
    const shutdown = vi.fn(async () => undefined);
    const exit = vi.fn();
    const unregister = registerProcessHandlers({
      shutdown,
      processTarget: processTarget as unknown as NodeJS.Process,
      exit,
    });

    processTarget.emit("SIGTERM");
    processTarget.emit("SIGINT");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledOnce());

    expect(shutdown).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
    unregister();
    expect(processTarget.listenerCount("SIGTERM")).toBe(0);
    expect(processTarget.listenerCount("SIGINT")).toBe(0);
  });
});
