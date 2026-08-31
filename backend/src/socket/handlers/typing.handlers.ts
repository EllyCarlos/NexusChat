import type { Socket } from "socket.io";
import { Events } from "../../enums/event/event.enum.js";
import { userTypingEventSchema } from "../../schemas/socket.schema.js";
import { assertChatMember } from "../../services/authorization.service.js";
import { logServerError } from "../../utils/safe-logger.utils.js";
import type { SocketEventRateLimitPort } from "../socket-event-rate-limit.port.js";
import {
  enforceSocketEventLimits,
  parseSocketPayload,
  SOCKET_EVENT_LIMITS,
} from "../socket-security.js";
import type { UserTypingRealtimePayload } from "../realtime/contracts/chat-realtime.types.js";
import type { ChatInteractionRealtimePort } from "../realtime/contracts/interaction-realtime.port.js";

type TypingHandlerDependencies = {
  socket: Socket;
  userId: string;
  limiter: SocketEventRateLimitPort;
  realtime: ChatInteractionRealtimePort;
};

export const registerTypingHandlers = ({
  socket,
  userId,
  limiter,
  realtime,
}: TypingHandlerDependencies): void => {
  socket.on(Events.USER_TYPING, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.USER_TYPING, userTypingEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { chatId } = parsedPayload;
    if (!(await enforceSocketEventLimits({
      socket,
      event: Events.USER_TYPING,
      limiter,
      policies: [SOCKET_EVENT_LIMITS.typingActor],
      keyParts: [userId],
    }))) return;
    try {
      await assertChatMember(userId, chatId);
      if (!(await enforceSocketEventLimits({
        socket,
        event: Events.USER_TYPING,
        limiter,
        policies: [SOCKET_EVENT_LIMITS.typingChat],
        keyParts: [userId, chatId],
      }))) return;

      const payload: UserTypingRealtimePayload = {
        user: {
          id: socket.user.id,
          username: socket.user.username,
          avatar: socket.user.avatar,
        },
        chatId,
      };

      realtime.broadcastTypingToOthers(chatId, payload);
    } catch (error) {
      logServerError("Socket typing event failed.", error);
    }
  });
};
