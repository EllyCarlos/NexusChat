import type { Server as HttpServer } from "node:http";
import { performance } from "node:perf_hooks";
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
import type {
  LogLifecycleStage,
  LogShutdownReason,
} from "../observability/log-event.types.js";
import type { MetricsPort } from "../observability/metrics.port.js";
import {
  emitLifecycleError,
  emitLifecycleLog,
  monotonicDuration,
  type MonotonicClock,
} from "../observability/lifecycle-logger.js";
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
import { createProcessMetrics } from "./metrics-composition.js";

type StartServerOptions = {
  createServer?: (options?: CreateBackendServerOptions) => BackendServer;
  port?: string | number;
  environment?: NodeEnvironment;
  redisUrl?: string;
  prepareTransport?: (options: {
    io: BackendServer["io"];
    mode: SocketTransportMode;
    logger?: ReturnType<typeof createProcessLogger>;
    metrics?: MetricsPort;
  }) => Promise<SocketTransportRuntime>;
  createConnectionState?: (options: {
    mode: SocketTransportMode;
    logger?: ReturnType<typeof createProcessLogger>;
    metrics?: MetricsPort;
  }) => SocketConnectionStateRuntime;
  createMetrics?: () => MetricsPort;
  disconnectPrisma?: () => Promise<void>;
  registerHandlers?: typeof registerProcessHandlers;
  logStarted?: (port: string | number) => void;
  createLogger?: (options: ProcessLoggerOptions) => ReturnType<typeof createProcessLogger>;
  clock?: MonotonicClock;
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
  createMetrics = () => createProcessMetrics({ enabled: config.metrics.enabled }),
  disconnectPrisma = () => prisma.$disconnect(),
  registerHandlers = registerProcessHandlers,
  logStarted,
  createLogger = createProcessLogger,
  clock = performance.now.bind(performance),
}: StartServerOptions = {}) => {
  const startupStartedAt = clock();
  const mode = resolveSocketTransportMode({ environment, redisUrl });
  const logger = createLogger({ environment, runtimeMode: mode.kind });
  const metrics = createMetrics();
  emitLifecycleLog(logger, "info", "bootstrap.startup.started", {
    result: "started",
  });
  const observeSyncStage = <Result>(
    stage: LogLifecycleStage,
    operation: () => Result,
  ): Result => {
    const startedAt = clock();
    emitLifecycleLog(logger, "info", "bootstrap.startup_stage.started", {
      stage,
      result: "started",
    });
    try {
      const result = operation();
      emitLifecycleLog(logger, "info", "bootstrap.startup_stage.completed", {
        stage,
        result: "completed",
        durationMs: monotonicDuration(startedAt, clock),
      });
      return result;
    } catch (error) {
      emitLifecycleError(logger, "bootstrap.startup_stage.failed", error, {
        stage,
        result: "failed",
        durationMs: monotonicDuration(startedAt, clock),
      });
      throw error;
    }
  };
  const observeAsyncStage = async <Result>(
    stage: LogLifecycleStage,
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    const startedAt = clock();
    emitLifecycleLog(logger, "info", "bootstrap.startup_stage.started", {
      stage,
      result: "started",
    });
    try {
      const result = await operation();
      emitLifecycleLog(logger, "info", "bootstrap.startup_stage.completed", {
        stage,
        result: "completed",
        durationMs: monotonicDuration(startedAt, clock),
      });
      return result;
    } catch (error) {
      emitLifecycleError(logger, "bootstrap.startup_stage.failed", error, {
        stage,
        result: "failed",
        durationMs: monotonicDuration(startedAt, clock),
      });
      throw error;
    }
  };
  const connectionState = observeSyncStage(
    "connection_state_construction",
    () => createConnectionState({ mode, logger, metrics }),
  );
  let socketTransport: SocketTransportRuntime | undefined;
  let runtime: BackendServer | undefined;
  let closeResources: ((reason?: LogShutdownReason) => Promise<void>) | undefined;
  try {
    runtime = observeSyncStage(
      "server_construction",
      () => createServer({
        connectionState,
        logger,
        metrics,
        readiness: () => socketTransport?.isReady === true
          && connectionState.isReady
          && (runtime?.socketLifecycle?.isAcceptingConnections ?? true),
      }),
    );
  } catch (error) {
    connectionState.markDraining();
    try {
      await connectionState.close();
    } catch (closeError) {
      emitLifecycleError(logger, "bootstrap.connection_state_shutdown.failed", closeError);
    }
    try {
      await disconnectPrisma();
    } catch (closeError) {
      emitLifecycleError(logger, "bootstrap.prisma_shutdown.failed", closeError);
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
  const shutdown = async (reason: LogShutdownReason = "manual") => {
    unregisterHandlers();
    await closeResources(reason);
  };
  try {
    socketTransport = await observeAsyncStage(
      "socket_transport",
      () => prepareTransport({ io: runtime!.io, mode, logger, metrics }),
    );
    await observeAsyncStage("connection_state_connect", () => connectionState.connect());
    await observeAsyncStage(
      "connection_maintenance",
      () => connectionState.start({
        reconcilePresence: async (userId) => {
          await runtime?.socketLifecycle?.reconcilePresence(userId);
        },
        handleLostConnection: ({ userId, socketId }) => {
          runtime?.socketLifecycle?.handleLostConnection(userId, socketId);
        },
      }),
    );
    unregisterHandlers = observeSyncStage(
      "process_handlers",
      () => registerHandlers({ shutdown, logger }),
    );
    await observeAsyncStage("http_listen", () => listen(runtime!.httpServer, port));
  } catch (error) {
    unregisterHandlers();
    try {
      await closeResources("startup_failure");
    } catch {
      // Individual shutdown failures are already sanitized and logged.
    }
    throw error;
  }

  if (logStarted) {
    logStarted(port);
  }
  emitLifecycleLog(logger, "info", "bootstrap.startup.completed", {
    result: "completed",
    durationMs: monotonicDuration(startupStartedAt, clock),
  });
  return { ...runtime, connectionState, socketTransport, logger, shutdown };
};
