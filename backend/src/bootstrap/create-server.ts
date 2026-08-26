import { createServer, type Server as HttpServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import "../config/cloudinary.config.js";
import "../passport/google.strategy.js";

import { createApp } from "../app.js";
import { config } from "../config/env.config.js";
import { socketAuthenticatorMiddleware } from "../middlewares/socket-auth.middleware.js";
import attachmentRoutes from "../routes/attachment.router.js";
import authRoutes from "../routes/auth.router.js";
import chatRoutes from "../routes/chat.router.js";
import messageRoutes from "../routes/message.router.js";
import requestRoutes from "../routes/request.router.js";
import userRoutes from "../routes/user.router.js";
import { env } from "../schemas/env.schema.js";
import {
  createOriginPolicy,
  createSocketAllowRequest,
} from "../security/origin-policy.js";
import registerSocketHandlers from "../socket/socket.js";

export type BackendServer = {
  app: ReturnType<typeof createApp>;
  httpServer: HttpServer;
  io: SocketServer;
};

export const createBackendServer = (): BackendServer => {
  const originPolicy = createOriginPolicy({
    environment: env.NODE_ENV,
    frontendOrigin: config.clientUrl,
    vercelUrl: process.env.VERCEL_URL,
  });
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
  });
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
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

  return { app, httpServer, io };
};
