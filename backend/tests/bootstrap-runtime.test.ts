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
  runtimeConfig: {
    app: {
      environment: "test",
      port: "4000",
      clientUrl: "http://localhost:3000",
      serverUrl: "http://localhost:4000",
    },
  },
}));

vi.mock("../src/config/env.config.js", () => ({
  config: mocks.runtimeConfig,
}));
vi.mock("../src/config/providers.config.js", () => ({
  initializeProviders: mocks.initializeProviders,
}));
vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: { $disconnect: mocks.disconnectPrisma },
}));
vi.mock("../src/middlewares/socket-auth.middleware.js", () => ({
  socketAuthenticatorMiddleware: mocks.socketAuthenticator,
}));
vi.mock("../src/socket/socket.js", () => ({
  default: mocks.registerSocketHandlers,
}));
vi.mock("../src/routes/attachment.router.js", () => ({ default: mocks.route }));
vi.mock("../src/routes/auth.router.js", () => ({ default: mocks.route }));
vi.mock("../src/routes/chat.router.js", () => ({ default: mocks.route }));
vi.mock("../src/routes/message.router.js", () => ({ default: mocks.route }));
vi.mock("../src/routes/request.router.js", () => ({ default: mocks.route }));
vi.mock("../src/routes/user.router.js", () => ({ default: mocks.route }));

import type { BackendServer } from "../src/bootstrap/create-server.js";

const createFakeRuntime = ({ listenError }: { listenError?: Error } = {}) => {
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

  return {
    httpServer,
    io,
    runtime: {
      app: vi.fn(),
      httpServer,
      io,
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
  });

  it("returns an unbound Express, HTTP, and Socket.IO runtime", async () => {
    const { createBackendServer } = await import("../src/bootstrap/create-server.js");
    const useSpy = vi.spyOn(SocketServer.prototype, "use");

    const runtime = createBackendServer();

    expect(runtime.app).toBeTypeOf("function");
    expect(runtime.httpServer).toBeInstanceOf(HttpServer);
    expect(runtime.httpServer.listening).toBe(false);
    expect(runtime.io).toBeDefined();
    expect(mocks.initializeProviders).toHaveBeenCalledWith(mocks.runtimeConfig);
    expect(mocks.initializeProviders.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.registerSocketHandlers.mock.invocationCallOrder[0],
    );
    expect(useSpy).toHaveBeenCalledWith(mocks.socketAuthenticator);
    expect(mocks.registerSocketHandlers).toHaveBeenCalledWith(runtime.io);
    runtime.io.close();
    useSpy.mockRestore();
  });
});

describe("backend startup", () => {
  it("listens exactly once and returns an explicit shutdown handle", async () => {
    const { startServer } = await import("../src/bootstrap/start-server.js");
    const fake = createFakeRuntime();
    const unregisterHandlers = vi.fn();
    const registerHandlers = vi.fn(() => unregisterHandlers);
    const disconnectPrisma = vi.fn(async () => undefined);
    const logStarted = vi.fn();

    const started = await startServer({
      createServer: () => fake.runtime,
      port: 4321,
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
    expect(fake.io.close).toHaveBeenCalledOnce();
    expect(fake.httpServer.close).toHaveBeenCalledOnce();
    expect(disconnectPrisma).toHaveBeenCalledOnce();
  });

  it("surfaces listener errors after closing constructed resources", async () => {
    const { startServer } = await import("../src/bootstrap/start-server.js");
    const listenerError = new Error("private listener configuration");
    const fake = createFakeRuntime({ listenError: listenerError });
    const unregisterHandlers = vi.fn();
    const disconnectPrisma = vi.fn(async () => undefined);
    const logStarted = vi.fn();

    await expect(startServer({
      createServer: () => fake.runtime,
      disconnectPrisma,
      registerHandlers: vi.fn(() => unregisterHandlers),
      logStarted,
    })).rejects.toBe(listenerError);

    expect(unregisterHandlers).toHaveBeenCalledOnce();
    expect(fake.io.close).toHaveBeenCalledOnce();
    expect(fake.httpServer.close).toHaveBeenCalledOnce();
    expect(disconnectPrisma).toHaveBeenCalledOnce();
    expect(logStarted).not.toHaveBeenCalled();
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
  it("closes Socket.IO, HTTP, and Prisma once in order", async () => {
    const { createShutdownCoordinator } = await import("../src/bootstrap/shutdown.js");
    const fake = createFakeRuntime();
    const disconnectPrisma = vi.fn(async () => undefined);
    const shutdown = createShutdownCoordinator({
      httpServer: fake.runtime.httpServer,
      io: fake.runtime.io,
      disconnectPrisma,
    });

    await Promise.all([shutdown(), shutdown(), shutdown()]);

    expect(fake.io.close).toHaveBeenCalledOnce();
    expect(fake.httpServer.close).toHaveBeenCalledOnce();
    expect(disconnectPrisma).toHaveBeenCalledOnce();
    expect(fake.io.close.mock.invocationCallOrder[0]).toBeLessThan(
      fake.httpServer.close.mock.invocationCallOrder[0],
    );
    expect(fake.httpServer.close.mock.invocationCallOrder[0]).toBeLessThan(
      disconnectPrisma.mock.invocationCallOrder[0],
    );
  });

  it("continues coordinated cleanup and sanitizes individual shutdown failures", async () => {
    const { createShutdownCoordinator } = await import("../src/bootstrap/shutdown.js");
    const fake = createFakeRuntime();
    const disconnectPrisma = vi.fn(async () => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fake.io.close.mockImplementationOnce(() => {
      throw new Error("socket-secret-internal-detail");
    });
    const shutdown = createShutdownCoordinator({
      httpServer: fake.runtime.httpServer,
      io: fake.runtime.io,
      disconnectPrisma,
    });

    await expect(shutdown()).rejects.toThrow("Backend shutdown failed");

    expect(fake.httpServer.close).toHaveBeenCalledOnce();
    expect(disconnectPrisma).toHaveBeenCalledOnce();
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain("Socket.IO shutdown failed.");
    expect(logged).not.toContain("socket-secret-internal-detail");
    errorSpy.mockRestore();
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
