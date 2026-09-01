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
import { logSafeError } from "../observability/safe-error.js";
import {
  createBackendServer,
  type BackendServer,
  type CreateBackendServerOptions,
} from "./create-server.js";
import {
  createShutdownCoordinator,
  registerProcessHandlers,
} from "./shutdown.js";
import {
  createProcessLogger,
  type ProcessLoggerOptions,
} from "./logger-composition.js";

type StartServerOptions = {
  createServer?: (options?: CreateBackendServerOptions) => BackendServer;
  port?: string | number;
  environment?: NodeEnvironment;
  redisUrl?: string;
  prepareTransport?: (options: {
    io: BackendServer["io"];
    mode: SocketTransportMode;
    logger?: ReturnType<typeof createProcessLogger>;
  }) => Promise<SocketTransportRuntime>;
  createConnectionState?: (options: {
    mode: SocketTransportMode;
    logger?: ReturnType<typeof createProcessLogger>;
  }) => SocketConnectionStateRuntime;
  disconnectPrisma?: () => Promise<void>;
  registerHandlers?: typeof registerProcessHandlers;
  logStarted?: (port: string | number) => void;
  createLogger?: (options: ProcessLoggerOptions) => ReturnType<typeof createProcessLogger>;
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

export const startServer = async ({
  createServer = createBackendServer,
  port = config.app.port,
  environment = config.app.environment,
  redisUrl = config.redis.url,
  prepareTransport = prepareSocketTransport,
  createConnectionState = createSocketConnectionStateRuntime,
  disconnectPrisma = () => prisma.$disconnect(),
  registerHandlers = registerProcessHandlers,
  logStarted,
  createLogger = createProcessLogger,
}: StartServerOptions = {}) => {
  const mode = resolveSocketTransportMode({ environment, redisUrl });
  const logger = createLogger({ environment, runtimeMode: mode.kind });
  logger.info("bootstrap.runtime.selected", { result: "completed" });
  const connectionState = createConnectionState({ mode, logger });
  let socketTransport: SocketTransportRuntime | undefined;
  let runtime: BackendServer | undefined;
  let closeResources: (() => Promise<void>) | undefined;
  try {
    runtime = createServer({
      connectionState,
      logger,
      readiness: () => socketTransport?.isReady === true
        && connectionState.isReady
        && (runtime?.socketLifecycle?.isAcceptingConnections ?? true),
    });
  } catch (error) {
    connectionState.markDraining();
    try {
      await connectionState.close();
    } catch (closeError) {
      logSafeError(logger, "bootstrap.connection_state_shutdown.failed", closeError);
    }
    try {
      await disconnectPrisma();
    } catch (closeError) {
      logSafeError(logger, "bootstrap.prisma_shutdown.failed", closeError);
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
    logger,
  });
  let unregisterHandlers: () => void = () => undefined;
  const shutdown = async () => {
    unregisterHandlers();
    await closeResources();
  };
  try {
    socketTransport = await prepareTransport({ io: runtime.io, mode, logger });
    await connectionState.connect();
    await connectionState.start({
      reconcilePresence: async (userId) => {
        await runtime?.socketLifecycle?.reconcilePresence(userId);
      },
      handleLostConnection: ({ userId, socketId }) => {
        runtime?.socketLifecycle?.handleLostConnection(userId, socketId);
      },
    });
    unregisterHandlers = registerHandlers({ shutdown, logger });
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

  if (logStarted) {
    logStarted(port);
  } else {
    logger.info("bootstrap.server.listening", { result: "completed" });
  }
  return { ...runtime, connectionState, socketTransport, logger, shutdown };
};
