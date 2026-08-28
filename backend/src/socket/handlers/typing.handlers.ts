import type { Socket } from "socket.io";
import { Events } from "../../enums/event/event.enum.js";
import { userTypingEventSchema } from "../../schemas/socket.schema.js";
import { assertChatMember } from "../../services/authorization.service.js";
import { logServerError } from "../../utils/safe-logger.utils.js";
import {
  enforceSocketEventLimits,
  parseSocketPayload,
  SOCKET_EVENT_LIMITS,
  type SocketEventRateLimiter,
} from "../socket-security.js";

type UserTypingEventSendPayload = {
  user: {
    id: string;
    username: string;
    avatar: string;
  };
  chatId: string;
};

type TypingHandlerDependencies = {
  socket: Socket;
  userId: string;
  limiter: SocketEventRateLimiter;
};

export const registerTypingHandlers = ({
  socket,
  userId,
  limiter,
}: TypingHandlerDependencies): void => {
  socket.on(Events.USER_TYPING, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.USER_TYPING, userTypingEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { chatId } = parsedPayload;
    if (!enforceSocketEventLimits({
      socket,
      event: Events.USER_TYPING,
      limiter,
      policies: [SOCKET_EVENT_LIMITS.typingActor],
      keyParts: [userId],
    })) return;
    try {
      await assertChatMember(userId, chatId);
      if (!enforceSocketEventLimits({
        socket,
        event: Events.USER_TYPING,
        limiter,
        policies: [SOCKET_EVENT_LIMITS.typingChat],
        keyParts: [userId, chatId],
      })) return;

      const payload: UserTypingEventSendPayload = {
        user: {
          id: socket.user.id,
          username: socket.user.username,
          avatar: socket.user.avatar,
        },
        chatId,
      };

      socket.broadcast.to(chatId).emit(Events.USER_TYPING, payload);
    } catch (error) {
      logServerError("Socket typing event failed.", error);
    }
  });
};
