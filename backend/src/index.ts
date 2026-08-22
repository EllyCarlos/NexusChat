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
import registerSocketHandlers from "./socket/socket.js";
import { logServerError } from "./utils/safe-logger.utils.js";

export const userSocketIds = new Map<string, string>();

const corsOrigins = env.NODE_ENV === "production"
  ? [config.clientUrl, process.env.VERCEL_URL].filter((url): url is string => Boolean(url))
  : [config.clientUrl, "http://localhost:3000"];

export const createBackendServer = () => {
  let io: Server | undefined;
  const app = createApp({
    corsOrigins,
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
    cors: {
      credentials: true,
      origin: corsOrigins,
    },
  });

  app.set("io", io);
  io.use(socketAuthenticatorMiddleware);
  registerSocketHandlers(io);
  io.on("connection", (socket) => {
    console.log("Socket client connected.");

    socket.on("disconnect", () => {
      console.log("Socket client disconnected.");

      for (const [userId, socketId] of userSocketIds.entries()) {
        if (socketId === socket.id) {
          userSocketIds.delete(userId);
          console.log("Socket user mapping removed.");
          break;
        }
      }
    });
  });

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
