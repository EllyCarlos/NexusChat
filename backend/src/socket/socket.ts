import type { Server, Socket } from "socket.io";
import { Events } from "../enums/event/event.enum.js";
import { prisma } from "../lib/prisma.lib.js";
import { logServerError } from "../utils/safe-logger.utils.js";
import {
  socketConnectionRegistry,
  socketPresenceWriteQueue,
  type SocketConnectionRegistry,
  type SocketPresenceWriteQueue,
} from "./connection-registry.js";
import { registerMessageLifecycleHandlers } from "./handlers/message-lifecycle.handlers.js";
import { registerMessageHandlers } from "./handlers/message.handlers.js";
import { registerPinHandlers } from "./handlers/pin.handlers.js";
import { registerPollHandlers } from "./handlers/poll.handlers.js";
import { registerReactionHandlers } from "./handlers/reaction.handlers.js";
import { registerTypingHandlers } from "./handlers/typing.handlers.js";
import { createSocketChatEventRealtimeAdapter } from "./realtime/infrastructure/socket-chat-event-realtime.adapter.js";
import {
  emitSocketSecurityError,
  socketEventRateLimiter,
  type SocketEventRateLimiter,
} from "./socket-security.js";
import registerWebRtcHandlers from "./webrtc/socket.js";

type OfflineUserEventSendPayload = {
  userId: string;
};

type OnlineUserEventSendPayload = OfflineUserEventSendPayload;

type OnlineUsersListEventSendPayload = {
  onlineUserIds: string[];
};

type SocketHandlerDependencies = {
  registry?: SocketConnectionRegistry;
  limiter?: SocketEventRateLimiter;
  presenceWriteQueue?: SocketPresenceWriteQueue;
};

const registerSocketHandlers = (
  io: Server,
  dependencies: SocketHandlerDependencies = {},
) => {
  const registry = dependencies.registry ?? socketConnectionRegistry;
  const limiter = dependencies.limiter ?? socketEventRateLimiter;
  const presenceWriteQueue = dependencies.presenceWriteQueue ?? socketPresenceWriteQueue;

  io.on("connection", async (socket: Socket) => {
    if (!socket.user) {
      socket.disconnect(true);
      return;
    }

    const userId = socket.user.id;
    const registration = registry.add(userId, socket.id);
    if (!registration.accepted) {
      emitSocketSecurityError(socket, "CONNECTION_LIMIT", "connection");
      socket.disconnect(true);
      return;
    }

    socket.on("disconnect", async () => {
      const removal = registry.remove(userId, socket.id);
      if (!removal.lastConnection) return;

      try {
        await presenceWriteQueue.run(userId, () => prisma.user.update({
          where: { id: userId },
          data: { isOnline: false, lastSeen: new Date() },
        }));
      } catch (error) {
        logServerError("Socket offline presence update failed.", error);
      }

      if (registry.isOnline(userId)) return;
      const payload: OfflineUserEventSendPayload = { userId };
      socket.broadcast.emit(Events.OFFLINE_USER, payload);
    });

    if (registration.firstConnection) {
      try {
        await presenceWriteQueue.run(userId, () => prisma.user.update({
          where: { id: userId },
          data: { isOnline: true },
        }));
      } catch (error) {
        logServerError("Socket online presence update failed.", error);
      }

      if (registry.isOnline(userId)) {
        const payload: OnlineUserEventSendPayload = { userId };
        socket.broadcast.emit(Events.ONLINE_USER, payload);
      }
    }

    const payloadOnlineUsers: OnlineUsersListEventSendPayload = {
      onlineUserIds: registry.onlineUserIds(),
    };
    socket.emit(Events.ONLINE_USERS_LIST, payloadOnlineUsers);

    try {
      const userChats = await prisma.chatMembers.findMany({
        where: { userId },
        select: { chatId: true },
      });
      socket.join(userChats.map(({ chatId }) => chatId));
    } catch (error) {
      logServerError("Socket room initialization failed.", error);
    }

    const realtime = createSocketChatEventRealtimeAdapter({ io, socket });

    registerMessageHandlers({ socket, userId, limiter, realtime });
    registerMessageLifecycleHandlers({ socket, userId, limiter, realtime });
    registerReactionHandlers({ socket, userId, limiter, realtime });
    registerTypingHandlers({ socket, userId, limiter, realtime });
    registerPollHandlers({ socket, userId, limiter, realtime });
    registerPinHandlers({ socket, userId, limiter, realtime });
    registerWebRtcHandlers(socket, io, { registry, limiter });
  });
};

export default registerSocketHandlers;
