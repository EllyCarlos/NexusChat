import type { Server as HttpServer } from "node:http";
import { performance } from "node:perf_hooks";
import type { Server as SocketServer } from "socket.io";
import type {
  LogLifecycleStage,
  LogShutdownReason,
} from "../observability/log-event.types.js";
import {
  emitLifecycleError,
  emitLifecycleLog,
  monotonicDuration,
  type MonotonicClock,
} from "../observability/lifecycle-logger.js";
import type { LoggerPort } from "../observability/logger.port.js";
import { noopLogger } from "../observability/noop-logger.js";

type ShutdownOptions = {
  httpServer: HttpServer;
  io: SocketServer;
  beginSocketDrain?: () => void;
  disconnectLocalSockets?: () => void;
  drainSocketOperations?: () => Promise<void>;
  closeConnectionState?: () => Promise<void>;
  closeDistributedRealtime?: () => Promise<void>;
  disconnectPrisma: () => Promise<void>;
  stageTimeoutMs?: number;
  logger?: LoggerPort;
  clock?: MonotonicClock;
};

type ProcessHandlerOptions = {
  shutdown: (reason?: LogShutdownReason) => Promise<void>;
  processTarget?: NodeJS.Process;
  exit?: (code: number) => void;
  logger?: LoggerPort;
};

const closeSocketServer = async (io: SocketServer) => {
  await io.close();
};

export const SHUTDOWN_STAGE_TIMEOUT_MS = 15_000;

type ShutdownStageOutcome =
  | { succeeded: true }
  | { succeeded: false; error: unknown; timedOut?: boolean };

type StartedShutdownStage = {
  readonly stage: LogLifecycleStage;
  readonly startedAt: number;
  readonly outcome: Promise<ShutdownStageOutcome>;
};

const observeShutdownStage = (
  stage: () => Promise<void>,
): Promise<ShutdownStageOutcome> => {
  try {
    return stage().then(
      () => ({ succeeded: true }),
      (error: unknown) => ({ succeeded: false, error }),
    );
  } catch (error) {
    return Promise.resolve({ succeeded: false, error });
  }
};

const closeHttpServer = (httpServer: HttpServer) => new Promise<void>((resolve, reject) => {
  try {
    httpServer.close((error) => {
      if (!error || (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING") {
        resolve();
        return;
      }
      reject(error);
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING") {
      resolve();
      return;
    }
    reject(error);
  }
});

export const createShutdownCoordinator = ({
  httpServer,
  io,
  beginSocketDrain = () => undefined,
  disconnectLocalSockets = () => undefined,
  drainSocketOperations = async () => undefined,
  closeConnectionState = async () => undefined,
  closeDistributedRealtime = async () => undefined,
  disconnectPrisma,
  stageTimeoutMs = SHUTDOWN_STAGE_TIMEOUT_MS,
  logger = noopLogger.forComponent("bootstrap"),
  clock = performance.now.bind(performance),
}: ShutdownOptions) => {
  let shutdownPromise: Promise<void> | undefined;

  return (reason: LogShutdownReason = "manual") => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      const shutdownStartedAt = clock();
      emitLifecycleLog(logger, "info", "bootstrap.shutdown.started", {
        result: "started",
        reason,
      });
      let failureCount = 0;
      const beginStage = (
        stage: LogLifecycleStage,
        operation: () => Promise<void>,
      ): StartedShutdownStage => {
        const startedAt = clock();
        emitLifecycleLog(logger, "info", "bootstrap.shutdown_stage.started", {
          stage,
          result: "started",
        });
        return {
          stage,
          startedAt,
          outcome: observeShutdownStage(operation),
        };
      };
      const awaitStage = async ({
        stage,
        startedAt,
        outcome,
      }: StartedShutdownStage) => {
        let timeout: NodeJS.Timeout | undefined;
        const result = await Promise.race([
          outcome,
          new Promise<ShutdownStageOutcome>((resolve) => {
            timeout = setTimeout(() => {
              resolve({
                succeeded: false,
                error: new Error("Shutdown stage timed out."),
                timedOut: true,
              });
            }, stageTimeoutMs);
          }),
        ]);
        if (timeout) clearTimeout(timeout);

        if (!result.succeeded) {
          failureCount += 1;
          emitLifecycleError(logger, "bootstrap.shutdown_stage.failed", result.error, {
            stage,
            result: "failed",
            durationMs: monotonicDuration(startedAt, clock),
            ...(result.timedOut ? { errorCategory: "timeout" as const } : {}),
          });
          return;
        }
        emitLifecycleLog(logger, "info", "bootstrap.shutdown_stage.completed", {
          stage,
          result: "completed",
          durationMs: monotonicDuration(startedAt, clock),
        });
      };
      const runStage = async (
        stage: LogLifecycleStage,
        close: () => Promise<void>,
      ) => awaitStage(beginStage(stage, close));

      await runStage("socket_admission_drain", async () => {
        beginSocketDrain();
      });
      const httpCloseStage = beginStage(
        "http_server_shutdown",
        () => closeHttpServer(httpServer),
      );
      await runStage("local_socket_disconnect", async () => {
        disconnectLocalSockets();
      });
      await runStage(
        "socket_operation_drain",
        drainSocketOperations,
      );
      await awaitStage(httpCloseStage);
      await runStage("socket_io_shutdown", () => closeSocketServer(io));
      await runStage(
        "socket_operation_drain_after_socket_io",
        drainSocketOperations,
      );
      await runStage(
        "connection_state_shutdown",
        closeConnectionState,
      );
      await runStage(
        "distributed_realtime_shutdown",
        closeDistributedRealtime,
      );
      await runStage("prisma_shutdown", disconnectPrisma);

      if (failureCount > 0) {
        const error = new Error("Backend shutdown failed");
        emitLifecycleError(logger, "bootstrap.shutdown.failed", error, {
          reason,
          result: "failed",
          durationMs: monotonicDuration(shutdownStartedAt, clock),
        });
        throw error;
      }
      emitLifecycleLog(logger, "info", "bootstrap.shutdown.completed", {
        reason,
        result: "completed",
        durationMs: monotonicDuration(shutdownStartedAt, clock),
      });
    })();

    return shutdownPromise;
  };
};

export const registerProcessHandlers = ({
  shutdown,
  processTarget = process,
  exit = (code) => process.exit(code),
  logger = noopLogger.forComponent("bootstrap"),
}: ProcessHandlerOptions) => {
  let terminationStarted = false;

  const terminate = (exitCode: number, reason: LogShutdownReason) => {
    if (terminationStarted) {
      return;
    }
    terminationStarted = true;
    void shutdown(reason).then(
      () => exit(exitCode),
      () => exit(1),
    );
  };

  const handleSigterm = () => terminate(0, "sigterm");
  const handleSigint = () => terminate(0, "sigint");
  const handleUncaughtException = (error: Error) => {
    emitLifecycleError(logger, "bootstrap.uncaught_exception.failed", error, {
      reason: "uncaught_exception",
    });
    terminate(1, "uncaught_exception");
  };
  const handleUnhandledRejection = (reason: unknown) => {
    emitLifecycleError(logger, "bootstrap.unhandled_rejection.failed", reason, {
      reason: "unhandled_rejection",
    });
    terminate(1, "unhandled_rejection");
  };

  processTarget.on("SIGTERM", handleSigterm);
  processTarget.on("SIGINT", handleSigint);
  processTarget.on("uncaughtException", handleUncaughtException);
  processTarget.on("unhandledRejection", handleUnhandledRejection);

  return () => {
    processTarget.off("SIGTERM", handleSigterm);
    processTarget.off("SIGINT", handleSigint);
    processTarget.off("uncaughtException", handleUncaughtException);
    processTarget.off("unhandledRejection", handleUnhandledRejection);
  };
};
