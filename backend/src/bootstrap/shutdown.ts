import type { Server as HttpServer } from "node:http";
import type { Server as SocketServer } from "socket.io";
import type { LoggerPort } from "../observability/logger.port.js";
import { noopLogger } from "../observability/noop-logger.js";
import { logSafeError } from "../observability/safe-error.js";

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
};

type ProcessHandlerOptions = {
  shutdown: () => Promise<void>;
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
  | { succeeded: false; error: unknown };

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
}: ShutdownOptions) => {
  let shutdownPromise: Promise<void> | undefined;

  return () => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      logger.info("bootstrap.shutdown.started", { result: "started" });
      let failureCount = 0;
      const awaitResource = async (
        context: string,
        outcome: Promise<ShutdownStageOutcome>,
      ) => {
        let timeout: NodeJS.Timeout | undefined;
        const result = await Promise.race([
          outcome,
          new Promise<ShutdownStageOutcome>((resolve) => {
            timeout = setTimeout(() => {
              resolve({
                succeeded: false,
                error: new Error("Shutdown stage timed out."),
              });
            }, stageTimeoutMs);
          }),
        ]);
        if (timeout) clearTimeout(timeout);

        if (!result.succeeded) {
          failureCount += 1;
          logSafeError(logger, "bootstrap.shutdown_stage.failed", result.error, {
            stage: context
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_|_$/g, ""),
          });
        }
      };
      const closeResource = async (
        context: string,
        close: () => Promise<void>,
      ) => awaitResource(context, observeShutdownStage(close));

      await closeResource("Socket admission drain failed.", async () => {
        beginSocketDrain();
      });
      const httpCloseOutcome = observeShutdownStage(
        () => closeHttpServer(httpServer),
      );
      await closeResource("Local Socket disconnect failed.", async () => {
        disconnectLocalSockets();
      });
      await closeResource(
        "Socket operation drain failed.",
        drainSocketOperations,
      );
      await awaitResource("HTTP server shutdown failed.", httpCloseOutcome);
      await closeResource("Socket.IO shutdown failed.", () => closeSocketServer(io));
      await closeResource(
        "Socket operation drain after Socket.IO shutdown failed.",
        drainSocketOperations,
      );
      await closeResource(
        "Connection state shutdown failed.",
        closeConnectionState,
      );
      await closeResource(
        "Distributed realtime shutdown failed.",
        closeDistributedRealtime,
      );
      await closeResource("Prisma shutdown failed.", disconnectPrisma);

      if (failureCount > 0) {
        throw new Error("Backend shutdown failed");
      }
      logger.info("bootstrap.shutdown.completed", { result: "completed" });
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

  const terminate = (exitCode: number) => {
    if (terminationStarted) {
      return;
    }
    terminationStarted = true;
    void shutdown().then(
      () => exit(exitCode),
      () => exit(1),
    );
  };

  const handleSigterm = () => terminate(0);
  const handleSigint = () => terminate(0);
  const handleUncaughtException = (error: Error) => {
    logSafeError(logger, "bootstrap.uncaught_exception.failed", error);
    terminate(1);
  };
  const handleUnhandledRejection = (reason: unknown) => {
    logSafeError(logger, "bootstrap.unhandled_rejection.failed", reason);
    terminate(1);
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
