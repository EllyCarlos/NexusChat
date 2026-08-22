import { createServer } from "http";
import { Server } from "socket.io";
import "./config/cloudinary.config.js";
import "./passport/google.strategy.js";

import { createApp } from "./app.js";
import { config } from "./config/env.config.js";
import { prisma } from "./lib/prisma.lib.js";
import { socketAuthenticatorMiddleware } from "./middlewares/socket-auth.middleware.js";
import attachmentRoutes from "./routes/attachment.router.js";
import authRoutes from "./routes/auth.router.js";
import chatRoutes from "./routes/chat.router.js";
import messageRoutes from "./routes/message.router.js";
import requestRoutes from "./routes/request.router.js";
import userRoutes from "./routes/user.router.js";
import { checkEnvVariables, env } from "./schemas/env.schema.js";
import {
  createOriginPolicy,
  createSocketAllowRequest,
} from "./security/origin-policy.js";
import registerSocketHandlers from "./socket/socket.js";
import { logServerError } from "./utils/safe-logger.utils.js";

const originPolicy = createOriginPolicy({
  environment: env.NODE_ENV,
  frontendOrigin: config.clientUrl,
  vercelUrl: process.env.VERCEL_URL,
});

export const createBackendServer = () => {
  let io: Server | undefined;
  const app = createApp({
    originPolicy,
    environment: env.NODE_ENV,
    routes: [
      { path: "/api/v1/auth", router: authRoutes },
      { path: "/api/v1/chat", router: chatRoutes },
      { path: "/api/v1/user", router: userRoutes },
      { path: "/api/v1/request", router: requestRoutes },
      { path: "/api/v1/message", router: messageRoutes },
      { path: "/api/v1/attachment", router: attachmentRoutes },
    ],
    getConnectedClientCount: () => io?.engine.clientsCount ?? 0,
  });
  const server = createServer(app);
  io = new Server(server, {
    connectTimeout: 10_000,
    maxHttpBufferSize: 1_000_000,
    cors: {
      credentials: true,
      origin: [...originPolicy.origins],
    },
    allowRequest: createSocketAllowRequest(originPolicy),
  });

  app.set("io", io);
  io.use(socketAuthenticatorMiddleware);
  registerSocketHandlers(io);

  return { app, server, io };
};

const gracefulShutdown = async () => {
  console.log("Received shutdown signal, closing database connections...");
  try {
    await prisma.$disconnect();
    console.log("Database connections closed successfully");
    process.exit(0);
  } catch (error) {
    logServerError("Graceful shutdown failed.", error);
    process.exit(1);
  }
};

const registerProcessHandlers = () => {
  process.on("SIGTERM", gracefulShutdown);
  process.on("SIGINT", gracefulShutdown);
  process.on("beforeExit", gracefulShutdown);
  process.on("uncaughtException", (error) => {
    logServerError("Uncaught exception.", error);
    void gracefulShutdown();
  });
  process.on("unhandledRejection", (reason) => {
    logServerError("Unhandled promise rejection.", reason);
    void gracefulShutdown();
  });
};

export const startServer = () => {
  checkEnvVariables();
  const runtime = createBackendServer();
  registerProcessHandlers();
  runtime.server.listen(env.PORT, () => {
    const baseUrl = env.NODE_ENV === "production"
      ? "https://nexuschat-4slv.onrender.com"
      : `http://localhost:${env.PORT}`;

    console.log(`Server started at ${baseUrl}`);
    console.log(`Environment: ${env.NODE_ENV}`);
    console.log(`CORS origin: ${config.clientUrl}`);
    console.log("Socket.IO enabled with authentication");
    console.log(env.NODE_ENV === "production"
      ? "Production mode - security measures active"
      : "Development mode");
  });

  return runtime;
};

startServer();
