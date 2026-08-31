import { createServer, type Server as HttpServer } from "node:http";
import { Server as SocketServer } from "socket.io";

import { createApp } from "../app.js";
import { config } from "../config/env.config.js";
import { initializeProviders } from "../config/providers.config.js";
import { socketAuthenticatorMiddleware } from "../middlewares/socket-auth.middleware.js";
import { createSocketConnectionStateRuntime } from "../infrastructure/redis/socket-connection-state.runtime.js";
import type { SocketConnectionStateRuntime } from "../infrastructure/redis/socket-connection-state.runtime.js";
import attachmentRoutes from "../routes/attachment.router.js";
import authRoutes from "../routes/auth.router.js";
import chatRoutes from "../routes/chat.router.js";
import messageRoutes from "../routes/message.router.js";
import requestRoutes from "../routes/request.router.js";
import userRoutes from "../routes/user.router.js";
import {
  createOriginPolicy,
  createSocketAllowRequest,
} from "../security/origin-policy.js";
import { prismaSocketPresencePersistence } from "../socket/prisma-socket-presence.persistence.js";
import registerSocketHandlers, {
  type SocketHandlerLifecycle,
} from "../socket/socket.js";
import {
  createDistributedSocketPresenceCoordinator,
  createLocalSocketPresenceCoordinator,
  type SocketPresenceCoordinator,
} from "../socket/socket-presence.coordinator.js";
import { createSocketPresencePublisher } from "../socket/socket-presence.publisher.js";

export type BackendServer = {
  app: ReturnType<typeof createApp>;
  httpServer: HttpServer;
  io: SocketServer;
  connectionState: SocketConnectionStateRuntime;
  presence: SocketPresenceCoordinator;
  socketLifecycle: SocketHandlerLifecycle;
};

export type CreateBackendServerOptions = {
  connectionState?: SocketConnectionStateRuntime;
  readiness?: () => boolean;
};

export const createBackendServer = ({
  connectionState = createSocketConnectionStateRuntime({
    mode: { kind: "local" },
  }),
  readiness,
}: CreateBackendServerOptions = {}): BackendServer => {
  initializeProviders(config);
  const originPolicy = createOriginPolicy({
    environment: config.app.environment,
    frontendOrigin: config.app.clientUrl,
    vercelUrl: config.app.vercelUrl,
  });
  const app = createApp({
    originPolicy,
    environment: config.app.environment,
    readiness,
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
  app.set("connectionDirectory", connectionState.directory);
  io.use(socketAuthenticatorMiddleware);
  const publisher = createSocketPresencePublisher(io);
  const presence = connectionState.maintenance
    ? createDistributedSocketPresenceCoordinator({
      maintenance: connectionState.maintenance,
      persistence: prismaSocketPresencePersistence,
      publisher,
    })
    : createLocalSocketPresenceCoordinator({
      directory: connectionState.directory,
      publisher,
    });
  const socketLifecycle = registerSocketHandlers(io, {
    directory: connectionState.directory,
    limiter: connectionState.eventLimiter,
    presence,
  });

  return {
    app,
    httpServer,
    io,
    connectionState,
    presence,
    socketLifecycle,
  };
};
