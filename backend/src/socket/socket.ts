import type { Server, Socket } from "socket.io";
import { Events } from "../enums/event/event.enum.js";
import { prisma } from "../lib/prisma.lib.js";
import type { LoggerPort } from "../observability/logger.port.js";
import { noopLogger } from "../observability/noop-logger.js";
import { logSafeError } from "../observability/safe-error.js";
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
  const limiter = dependencies.limiter ?? createLocalSocketEventRateLimitProvider();
  const presenceWriteQueue = dependencies.presenceWriteQueue ?? socketPresenceWriteQueue;
  const logger = dependencies.logger ?? noopLogger.forComponent("socket");
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
      socket.disconnect(true);
      return;
    }

    if (!operationTracker.isAcceptingConnections) {
      socket.disconnect(true);
      return;
    }

    const userId = socket.user.id;
    let registrationAccepted = false;
    let disconnected = false;
    let removalPromise: Promise<void> | undefined;

    const removeAcceptedConnection = () => {
      if (!registrationAccepted) return Promise.resolve();
      if (removalPromise) return removalPromise;

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
      logSafeError(logger, "socket.connection_registration.failed", error);
      socket.disconnect(true);
      return;
    }

    if (!registration.accepted) {
      emitSocketSecurityError(socket, "CONNECTION_LIMIT", "connection");
      socket.disconnect(true);
      return;
    }
    registrationAccepted = true;

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

    registerMessageHandlers({ socket, userId, limiter, realtime, logger });
    registerMessageLifecycleHandlers({ socket, userId, limiter, realtime, logger });
    registerReactionHandlers({ socket, userId, limiter, realtime, logger });
    registerTypingHandlers({ socket, userId, limiter, realtime, logger });
    registerPollHandlers({ socket, userId, limiter, realtime, logger });
    registerPinHandlers({ socket, userId, limiter, realtime, logger });
    registerWebRtcHandlers(socket, io, { directory, limiter, logger });
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
