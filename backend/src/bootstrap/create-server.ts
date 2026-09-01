import { createServer, type Server as HttpServer } from "node:http";
import { Server as SocketServer } from "socket.io";

import { createApp } from "../app.js";
import { config } from "../config/env.config.js";
import { initializeProviders } from "../config/providers.config.js";
import { createSocketAuthenticatorMiddleware } from "../middlewares/socket-auth.middleware.js";
import type { LoggerPort } from "../observability/logger.port.js";
import { noopLogger } from "../observability/noop-logger.js";
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
  logger?: LoggerPort;
};

export const createBackendServer = ({
  connectionState = createSocketConnectionStateRuntime({
    mode: { kind: "local" },
  }),
  readiness,
  logger = noopLogger,
}: CreateBackendServerOptions = {}): BackendServer => {
  initializeProviders(config, logger.forComponent("provider"));
  const httpLogger = logger.forComponent("http");
  const socketLogger = logger.forComponent("socket");
  const presenceLogger = logger.forComponent("presence");
  const originPolicy = createOriginPolicy({
    environment: config.app.environment,
    frontendOrigin: config.app.clientUrl,
    vercelUrl: config.app.vercelUrl,
    onInvalidConfiguredOrigin: () => httpLogger.warn(
      "http.origin_configuration.ignored",
      { result: "rejected" },
    ),
  });
  const app = createApp({
    originPolicy,
    environment: config.app.environment,
    readiness,
    logger,
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
  io.use(createSocketAuthenticatorMiddleware(undefined, logger.forComponent("auth")));
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
      logger: presenceLogger,
    });
  const socketLifecycle = registerSocketHandlers(io, {
    directory: connectionState.directory,
    limiter: connectionState.eventLimiter,
    presence,
    logger: socketLogger,
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
