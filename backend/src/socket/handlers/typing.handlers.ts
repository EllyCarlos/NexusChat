import type { Socket } from "socket.io";
import { Events } from "../../enums/event/event.enum.js";
import { userTypingEventSchema } from "../../schemas/socket.schema.js";
import { assertChatMember } from "../../services/authorization.service.js";
import type { LoggerPort } from "../../observability/logger.port.js";
import type { MetricsPort } from "../../observability/metrics.port.js";
import { noopLogger } from "../../observability/noop-logger.js";
import { noopMetrics } from "../../observability/noop-metrics.js";
import { recordUnexpectedSocketOperationFailure } from "../../observability/realtime-metrics.js";
import { logSafeError } from "../../observability/safe-error.js";
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
  logger?: LoggerPort;
  metrics?: MetricsPort;
};

export const registerTypingHandlers = ({
  socket,
  userId,
  limiter,
  realtime,
  logger = noopLogger.forComponent("socket"),
  metrics = noopMetrics,
}: TypingHandlerDependencies): void => {
  socket.on(Events.USER_TYPING, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.USER_TYPING, userTypingEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { chatId } = parsedPayload;
    if (!(await enforceSocketEventLimits({
      socket,
      event: Events.USER_TYPING,
      limiter,
      logger,
      metrics,
      policies: [SOCKET_EVENT_LIMITS.typingActor],
      keyParts: [userId],
    }))) return;
    try {
      await assertChatMember(userId, chatId);
      if (!(await enforceSocketEventLimits({
        socket,
        event: Events.USER_TYPING,
        limiter,
        logger,
        metrics,
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
      recordUnexpectedSocketOperationFailure(metrics, "typing", error);
      logSafeError(logger, "socket.typing.failed", error, {
        operation: "typing",
        result: "failed",
      });
    }
  });
};
