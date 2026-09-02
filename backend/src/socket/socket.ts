import type { Server, Socket } from "socket.io";
import { Events } from "../enums/event/event.enum.js";
import { prisma } from "../lib/prisma.lib.js";
import type { LoggerPort } from "../observability/logger.port.js";
import type { LogRuntimeMode } from "../observability/log-event.types.js";
import type {
  MetricsPort,
  SocketConnectionMetricLifecycle,
} from "../observability/metrics.port.js";
import { noopLogger } from "../observability/noop-logger.js";
import { noopMetrics } from "../observability/noop-metrics.js";
import {
  recordSocketConnectionAdmission,
  startSocketConnectionMetric,
} from "../observability/realtime-metrics.js";
import { emitOperationLog } from "../observability/operation-observer.js";
import { logSafeError } from "../observability/safe-error.js";
import { sendPushNotification } from "../modules/notifications/push-notification.service.js";
import type { SendPushNotificationInput } from "../modules/notifications/application/send-push-notification.js";
import type {
  SocketConnectionDirectory,
  SocketPresenceTransition,
} from "./connection-directory.js";
import {
  socketConnectionRegistry,
  socketPresenceWriteQueue,
  type SocketConnectionRegistry,
  type SocketPresenceWriteQueue,
} from "./connection-registry.js";
import { createLocalSocketConnectionDirectory } from "./local-connection-directory.adapter.js";
import { registerMessageLifecycleHandlers } from "./handlers/message-lifecycle.handlers.js";
import { registerMessageHandlers } from "./handlers/message.handlers.js";
import { registerPinHandlers } from "./handlers/pin.handlers.js";
import { registerPollHandlers } from "./handlers/poll.handlers.js";
import { registerReactionHandlers } from "./handlers/reaction.handlers.js";
import { registerTypingHandlers } from "./handlers/typing.handlers.js";
import { createSocketChatEventRealtimeAdapter } from "./realtime/infrastructure/socket-chat-event-realtime.adapter.js";
import { createLocalSocketEventRateLimitProvider } from "./local-socket-event-rate-limit.adapter.js";
import { emitSocketSecurityError } from "./socket-security.js";
import type { SocketEventRateLimitPort } from "./socket-event-rate-limit.port.js";
import {
  createSocketOperationTracker,
  type SocketOperationTracker,
} from "./socket-operation-tracker.js";
import {
  createLocalSocketPresenceCoordinator,
  type SocketPresenceCoordinator,
} from "./socket-presence.coordinator.js";
import { createSocketPresencePublisher } from "./socket-presence.publisher.js";
import registerWebRtcHandlers from "./webrtc/socket.js";

type OnlineUsersListEventSendPayload = {
  onlineUserIds: string[];
};

type SocketHandlerDependencies = {
  directory?: SocketConnectionDirectory;
  registry?: SocketConnectionRegistry;
  limiter?: SocketEventRateLimitPort;
  presenceWriteQueue?: SocketPresenceWriteQueue;
  presence?: SocketPresenceCoordinator;
  operationTracker?: SocketOperationTracker;
  logger?: LoggerPort;
  metrics?: MetricsPort;
  runtimeMode?: LogRuntimeMode;
  sendNotification?: (input: SendPushNotificationInput) => void;
};

export interface SocketHandlerLifecycle {
  readonly isAcceptingConnections: boolean;
  beginDrain(): void;
  disconnectLocalSockets(): void;
  drain(): Promise<void>;
  reconcilePresence(userId: string): Promise<void>;
  handleLostConnection(userId: string, socketId: string): void;
}

const registerSocketHandlers = (
  io: Server,
  dependencies: SocketHandlerDependencies = {},
): SocketHandlerLifecycle => {
  const registry = dependencies.registry ?? socketConnectionRegistry;
  const directory = dependencies.directory
    ?? createLocalSocketConnectionDirectory(registry);
  const metrics = dependencies.metrics ?? noopMetrics;
  const runtimeMode = dependencies.runtimeMode ?? "local";
  const limiter = dependencies.limiter
    ?? createLocalSocketEventRateLimitProvider(undefined, metrics);
  const presenceWriteQueue = dependencies.presenceWriteQueue ?? socketPresenceWriteQueue;
  const logger = dependencies.logger ?? noopLogger.forComponent("socket");
  const sendNotification = dependencies.sendNotification ?? sendPushNotification;
  const presence = dependencies.presence ?? createLocalSocketPresenceCoordinator({
    directory,
    publisher: createSocketPresencePublisher(io),
    queue: presenceWriteQueue,
    logger: logger.forComponent("presence"),
  });
  const operationTracker = dependencies.operationTracker
    ?? createSocketOperationTracker();

  const reconcileTransition = async (transition: SocketPresenceTransition) => {
    try {
      await presence.reconcileTransition(transition);
    } catch (error) {
      logSafeError(
        logger,
        transition.state === "online"
          ? "socket.online_presence_update.failed"
          : "socket.offline_presence_update.failed",
        error,
      );
    }
  };

  io.on("connection", (socket: Socket) => operationTracker.track((async () => {
    if (!socket.user) {
      recordSocketConnectionAdmission(metrics, {
        result: "rejected",
        reason: "authentication",
      });
      socket.disconnect(true);
      return;
    }

    if (!operationTracker.isAcceptingConnections) {
      recordSocketConnectionAdmission(metrics, {
        result: "rejected",
        reason: "runtime_unavailable",
      });
      socket.disconnect(true);
      return;
    }

    const userId = socket.user.id;
    let registrationAccepted = false;
    let disconnected = false;
    let removalPromise: Promise<void> | undefined;
    let connectionMetric: SocketConnectionMetricLifecycle | undefined;

    const removeAcceptedConnection = () => {
      if (!registrationAccepted) return Promise.resolve();
      if (removalPromise) return removalPromise;

      connectionMetric?.complete();

      removalPromise = (async () => {
        try {
          const removal = await directory.remove(userId, socket.id);
          if (removal.presenceTransition) {
            await reconcileTransition(removal.presenceTransition);
          }
        } catch (error) {
          logSafeError(logger, "socket.connection_removal.failed", error);
        }
      })();
      return removalPromise;
    };

    socket.on("disconnect", () => {
      disconnected = true;
      if (!registrationAccepted) return undefined;
      return operationTracker.track(removeAcceptedConnection());
    });

    let registration;
    try {
      registration = await directory.add(userId, socket.id);
    } catch (error) {
      recordSocketConnectionAdmission(metrics, {
        result: "failed",
        reason: "registration_failure",
      });
      logSafeError(logger, "socket.connection_registration.failed", error, {
        operation: "connection_registration",
        result: "failed",
      });
      socket.disconnect(true);
      return;
    }

    if (!registration.accepted) {
      recordSocketConnectionAdmission(metrics, {
        result: "rejected",
        reason: "connection_cap",
      });
      emitOperationLog(logger, "debug", "socket.connection.rejected", {
        operation: "connection_registration",
        result: "rejected",
        rejectionReason: "connection_cap",
      });
      emitSocketSecurityError(socket, "CONNECTION_LIMIT", "connection");
      socket.disconnect(true);
      return;
    }
    registrationAccepted = true;
    recordSocketConnectionAdmission(metrics, {
      result: "accepted",
      reason: "none",
    });
    connectionMetric = startSocketConnectionMetric(metrics, { runtimeMode });

    const stopIfNoLongerAdmitted = async (): Promise<boolean> => {
      if (!disconnected && operationTracker.isAcceptingConnections) {
        return false;
      }
      await removeAcceptedConnection();
      if (!disconnected) socket.disconnect(true);
      return true;
    };

    if (await stopIfNoLongerAdmitted()) {
      return;
    }

    if (registration.presenceTransition) {
      await reconcileTransition(registration.presenceTransition);
    }
    if (await stopIfNoLongerAdmitted()) return;

    let onlineUserIds: string[];
    try {
      onlineUserIds = await directory.onlineUserIds();
    } catch (error) {
      logSafeError(logger, "socket.online_users_lookup.failed", error);
      await removeAcceptedConnection();
      socket.disconnect(true);
      return;
    }
    if (await stopIfNoLongerAdmitted()) return;
    const payloadOnlineUsers: OnlineUsersListEventSendPayload = {
      onlineUserIds,
    };
    socket.emit(Events.ONLINE_USERS_LIST, payloadOnlineUsers);

    try {
      const userChats = await prisma.chatMembers.findMany({
        where: { userId },
        select: { chatId: true },
      });
      socket.join(userChats.map(({ chatId }) => chatId));
    } catch (error) {
      logSafeError(logger, "socket.room_initialization.failed", error);
    }
    if (await stopIfNoLongerAdmitted()) return;

    const realtime = createSocketChatEventRealtimeAdapter({ io, socket });

    registerMessageHandlers({
      socket,
      userId,
      limiter,
      realtime,
      logger,
      sendNotification,
      metrics,
    });
    registerMessageLifecycleHandlers({
      socket, userId, limiter, realtime, logger, metrics,
    });
    registerReactionHandlers({ socket, userId, limiter, realtime, logger, metrics });
    registerTypingHandlers({ socket, userId, limiter, realtime, logger, metrics });
    registerPollHandlers({ socket, userId, limiter, realtime, logger, metrics });
    registerPinHandlers({ socket, userId, limiter, realtime, logger, metrics });
    registerWebRtcHandlers(socket, io, {
      directory,
      limiter,
      logger,
      sendNotification,
      metrics,
    });
  })()));

  return Object.freeze({
    get isAcceptingConnections() {
      return operationTracker.isAcceptingConnections;
    },
    beginDrain: () => operationTracker.beginDrain(),
    disconnectLocalSockets: () => {
      io.local.disconnectSockets(true);
    },
    drain: async () => {
      await operationTracker.drain();
      await presence.drain();
    },
    reconcilePresence: (userId: string) => presence.reconcileUser(userId),
    handleLostConnection: (_userId: string, socketId: string) => {
      io.local.in(socketId).disconnectSockets(true);
    },
  });
};

export default registerSocketHandlers;
