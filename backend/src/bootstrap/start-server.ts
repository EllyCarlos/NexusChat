import type { Server as HttpServer } from "node:http";
import { config } from "../config/env.config.js";
import {
  createSocketConnectionStateRuntime,
  type SocketConnectionStateRuntime,
} from "../infrastructure/redis/socket-connection-state.runtime.js";
import {
  prepareSocketTransport,
  resolveSocketTransportMode,
  type SocketTransportMode,
  type SocketTransportRuntime,
} from "../infrastructure/redis/socket-io-redis-adapter.js";
import { prisma } from "../lib/prisma.lib.js";
import type { NodeEnvironment } from "../schemas/env.schema.js";
import { logServerError } from "../utils/safe-logger.utils.js";
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
  createConnectionState?: (options: {
    mode: SocketTransportMode;
  }) => SocketConnectionStateRuntime;
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
  createConnectionState = createSocketConnectionStateRuntime,
  disconnectPrisma = () => prisma.$disconnect(),
  registerHandlers = registerProcessHandlers,
  logStarted = logSuccessfulStartup,
}: StartServerOptions = {}) => {
  const mode = resolveSocketTransportMode({ environment, redisUrl });
  const connectionState = createConnectionState({ mode });
  let socketTransport: SocketTransportRuntime | undefined;
  let runtime: BackendServer | undefined;
  let closeResources: (() => Promise<void>) | undefined;
  try {
    runtime = createServer({
      connectionState,
      readiness: () => socketTransport?.isReady === true
        && connectionState.isReady
        && (runtime?.socketLifecycle?.isAcceptingConnections ?? true),
    });
  } catch (error) {
    connectionState.markDraining();
    try {
      await connectionState.close();
    } catch (closeError) {
      logServerError("Connection state shutdown failed.", closeError);
    }
    try {
      await disconnectPrisma();
    } catch (closeError) {
      logServerError("Prisma shutdown failed.", closeError);
    }
    throw error;
  }
  closeResources = createShutdownCoordinator({
    httpServer: runtime.httpServer,
    io: runtime.io,
    beginSocketDrain: () => {
      connectionState.markDraining();
      runtime?.socketLifecycle?.beginDrain();
    },
    disconnectLocalSockets: () => {
      runtime?.socketLifecycle?.disconnectLocalSockets();
    },
    drainSocketOperations: async () => {
      await runtime?.socketLifecycle?.drain();
    },
    closeConnectionState: () => connectionState.close(),
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
    await connectionState.connect();
    await connectionState.start({
      reconcilePresence: async (userId) => {
        await runtime?.socketLifecycle?.reconcilePresence(userId);
      },
      handleLostConnection: ({ userId, socketId }) => {
        runtime?.socketLifecycle?.handleLostConnection(userId, socketId);
      },
    });
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
  return { ...runtime, connectionState, socketTransport, shutdown };
};
