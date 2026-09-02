import type { Socket } from "socket.io";
import { Events } from "../../enums/event/event.enum.js";
import { prisma } from "../../lib/prisma.lib.js";
import {
  deleteReactionEventSchema,
  newReactionEventSchema,
} from "../../schemas/socket.schema.js";
import { assertMessageAccessible } from "../../services/authorization.service.js";
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
import type {
  DeleteReactionRealtimePayload,
  NewReactionRealtimePayload,
} from "../realtime/contracts/chat-realtime.types.js";
import type { ChatInteractionRealtimePort } from "../realtime/contracts/interaction-realtime.port.js";

type ReactionHandlerDependencies = {
  socket: Socket;
  userId: string;
  limiter: SocketEventRateLimitPort;
  realtime: ChatInteractionRealtimePort;
  logger?: LoggerPort;
  metrics?: MetricsPort;
};

export const registerReactionHandlers = ({
  socket,
  userId,
  limiter,
  realtime,
  logger = noopLogger.forComponent("socket"),
  metrics = noopMetrics,
}: ReactionHandlerDependencies): void => {
  socket.on(Events.NEW_REACTION, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.NEW_REACTION, newReactionEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { chatId, messageId, reaction } = parsedPayload;
    if (!(await enforceSocketEventLimits({
      socket,
      event: Events.NEW_REACTION,
      limiter,
      logger,
      metrics,
      policies: [SOCKET_EVENT_LIMITS.mutationActor],
      keyParts: [userId],
    }))) return;
    try {
      const authorizedMessage = await assertMessageAccessible(userId, chatId, messageId);
      if (!(await enforceSocketEventLimits({
        socket,
        event: Events.NEW_REACTION,
        limiter,
        logger,
        metrics,
        policies: [SOCKET_EVENT_LIMITS.reactionMessage],
        keyParts: [userId, authorizedMessage.id],
      }))) return;

      const result = await prisma.reactions.findFirst({
        where: {
          userId: socket.user.id,
          messageId: authorizedMessage.id,
        },
      });

      if (result) return;

      await prisma.reactions.create({
        data: {
          reaction,
          userId: socket.user.id,
          messageId: authorizedMessage.id,
        },
      });

      const payload: NewReactionRealtimePayload = {
        chatId,
        messageId,
        user: {
          id: socket.user.id,
          username: socket.user.username,
          avatar: socket.user.avatar,
        },
        reaction,
      };

      realtime.emitNewReaction(chatId, payload);
    } catch (error) {
      recordUnexpectedSocketOperationFailure(metrics, "reaction_add", error);
      logSafeError(logger, "socket.reaction_addition.failed", error, {
        operation: "reaction_add",
        result: "failed",
      });
    }
  });

  socket.on(Events.DELETE_REACTION, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.DELETE_REACTION, deleteReactionEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { chatId, messageId } = parsedPayload;
    if (!(await enforceSocketEventLimits({
      socket,
      event: Events.DELETE_REACTION,
      limiter,
      logger,
      metrics,
      policies: [SOCKET_EVENT_LIMITS.mutationActor],
      keyParts: [userId],
    }))) return;
    try {
      const authorizedMessage = await assertMessageAccessible(userId, chatId, messageId);
      if (!(await enforceSocketEventLimits({
        socket,
        event: Events.DELETE_REACTION,
        limiter,
        logger,
        metrics,
        policies: [SOCKET_EVENT_LIMITS.reactionMessage],
        keyParts: [userId, authorizedMessage.id],
      }))) return;

      await prisma.reactions.deleteMany({
        where: {
          userId: socket.user.id,
          messageId: authorizedMessage.id,
        },
      });
      const payload: DeleteReactionRealtimePayload = {
        chatId,
        messageId,
        userId: socket.user.id,
      };
      realtime.emitDeleteReaction(chatId, payload);
    } catch (error) {
      recordUnexpectedSocketOperationFailure(metrics, "reaction_delete", error);
      logSafeError(logger, "socket.reaction_deletion.failed", error, {
        operation: "reaction_delete",
        result: "failed",
      });
    }
  });
};
