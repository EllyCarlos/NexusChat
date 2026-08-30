import type { Server as HttpServer } from "node:http";
import type { Server as SocketServer } from "socket.io";
import { logServerError } from "../utils/safe-logger.utils.js";

type ShutdownOptions = {
  httpServer: HttpServer;
  io: SocketServer;
  closeDistributedRealtime?: () => Promise<void>;
  disconnectPrisma: () => Promise<void>;
};

type ProcessHandlerOptions = {
  shutdown: () => Promise<void>;
  processTarget?: NodeJS.Process;
  exit?: (code: number) => void;
};

const closeSocketServer = async (io: SocketServer) => {
  await io.close();
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
  closeDistributedRealtime = async () => undefined,
  disconnectPrisma,
}: ShutdownOptions) => {
  let shutdownPromise: Promise<void> | undefined;

  return () => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      console.log("Closing backend runtime resources...");
      const failures: unknown[] = [];
      const closeResource = async (context: string, close: () => Promise<void>) => {
        try {
          await close();
        } catch (error) {
          failures.push(error);
          logServerError(context, error);
        }
      };

      await closeResource("Socket.IO shutdown failed.", () => closeSocketServer(io));
      await closeResource(
        "Distributed realtime shutdown failed.",
        closeDistributedRealtime,
      );
      await closeResource("HTTP server shutdown failed.", () => closeHttpServer(httpServer));
      await closeResource("Prisma shutdown failed.", disconnectPrisma);

      if (failures.length > 0) {
        throw new Error("Backend shutdown failed");
      }
      console.log("Backend runtime resources closed successfully");
    })();

    return shutdownPromise;
  };
};

export const registerProcessHandlers = ({
  shutdown,
  processTarget = process,
  exit = (code) => process.exit(code),
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
    logServerError("Uncaught exception.", error);
    terminate(1);
  };
  const handleUnhandledRejection = (reason: unknown) => {
    logServerError("Unhandled promise rejection.", reason);
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
