import type { Server as HttpServer } from "node:http";
import { config } from "../config/env.config.js";
import { prisma } from "../lib/prisma.lib.js";
import {
  createBackendServer,
  type BackendServer,
} from "./create-server.js";
import {
  createShutdownCoordinator,
  registerProcessHandlers,
} from "./shutdown.js";

type StartServerOptions = {
  createServer?: () => BackendServer;
  port?: string | number;
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
  disconnectPrisma = () => prisma.$disconnect(),
  registerHandlers = registerProcessHandlers,
  logStarted = logSuccessfulStartup,
}: StartServerOptions = {}) => {
  const runtime = createServer();
  const closeResources = createShutdownCoordinator({
    httpServer: runtime.httpServer,
    io: runtime.io,
    disconnectPrisma,
  });
  let unregisterHandlers: () => void = () => undefined;
  const shutdown = async () => {
    unregisterHandlers();
    await closeResources();
  };
  unregisterHandlers = registerHandlers({ shutdown });

  try {
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
  return { ...runtime, shutdown };
};
