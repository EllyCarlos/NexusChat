import type { Server as HttpServer } from "node:http";
import { config } from "../config/env.config.js";
import {
  prepareSocketTransport,
  resolveSocketTransportMode,
  type SocketTransportMode,
  type SocketTransportRuntime,
} from "../infrastructure/redis/socket-io-redis-adapter.js";
import { prisma } from "../lib/prisma.lib.js";
import type { NodeEnvironment } from "../schemas/env.schema.js";
import {
  createBackendServer,
  type BackendServer,
  type CreateBackendServerOptions,
} from "./create-server.js";
import {
  createShutdownCoordinator,
  registerProcessHandlers,
} from "./shutdown.js";

type StartServerOptions = {
  createServer?: (options?: CreateBackendServerOptions) => BackendServer;
  port?: string | number;
  environment?: NodeEnvironment;
  redisUrl?: string;
  prepareTransport?: (options: {
    io: BackendServer["io"];
    mode: SocketTransportMode;
  }) => Promise<SocketTransportRuntime>;
  disconnectPrisma?: () => Promise<void>;
  registerHandlers?: typeof registerProcessHandlers;
  logStarted?: (port: string | number) => void;
};

const listen = (httpServer: HttpServer, port: string | number) => new Promise<void>((resolve, reject) => {
  const handleListening = () => {
    httpServer.off("error", handleError);
    resolve();
  };
  const handleError = (error: Error) => {
    httpServer.off("listening", handleListening);
    reject(error);
  };

  httpServer.once("error", handleError);
  httpServer.once("listening", handleListening);
  try {
    httpServer.listen(port);
  } catch (error) {
    httpServer.off("error", handleError);
    httpServer.off("listening", handleListening);
    reject(error);
  }
});

const logSuccessfulStartup = (port: string | number) => {
  const baseUrl = config.app.environment === "production"
    ? config.app.serverUrl
    : `http://localhost:${port}`;

  console.log(`Server started at ${baseUrl}`);
  console.log(`Environment: ${config.app.environment}`);
  console.log(`CORS origin: ${config.app.clientUrl}`);
  console.log("Socket.IO enabled with authentication");
  console.log(config.app.environment === "production"
    ? "Production mode - security measures active"
    : "Development mode");
};

export const startServer = async ({
  createServer = createBackendServer,
  port = config.app.port,
  environment = config.app.environment,
  redisUrl = config.redis.url,
  prepareTransport = prepareSocketTransport,
  disconnectPrisma = () => prisma.$disconnect(),
  registerHandlers = registerProcessHandlers,
  logStarted = logSuccessfulStartup,
}: StartServerOptions = {}) => {
  const mode = resolveSocketTransportMode({ environment, redisUrl });
  let socketTransport: SocketTransportRuntime | undefined;
  const runtime = createServer({
    readiness: () => mode.kind === "local" || socketTransport?.isReady === true,
  });
  const closeResources = createShutdownCoordinator({
    httpServer: runtime.httpServer,
    io: runtime.io,
    closeDistributedRealtime: async () => {
      await socketTransport?.close();
    },
    disconnectPrisma,
  });
  let unregisterHandlers: () => void = () => undefined;
  const shutdown = async () => {
    unregisterHandlers();
    await closeResources();
  };
  try {
    socketTransport = await prepareTransport({ io: runtime.io, mode });
    unregisterHandlers = registerHandlers({ shutdown });
    await listen(runtime.httpServer, port);
  } catch (error) {
    unregisterHandlers();
    try {
      await closeResources();
    } catch {
      // Individual shutdown failures are already sanitized and logged.
    }
    throw error;
  }

  logStarted(port);
  return { ...runtime, socketTransport, shutdown };
};
