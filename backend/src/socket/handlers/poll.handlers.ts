import type { Socket } from "socket.io";
import { Events } from "../../enums/event/event.enum.js";
import { prisma } from "../../lib/prisma.lib.js";
import { voteEventSchema } from "../../schemas/socket.schema.js";
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
  VoteInRealtimePayload,
  VoteOutRealtimePayload,
} from "../realtime/contracts/chat-realtime.types.js";
import type { ChatInteractionRealtimePort } from "../realtime/contracts/interaction-realtime.port.js";

type PollHandlerDependencies = {
  socket: Socket;
  userId: string;
  limiter: SocketEventRateLimitPort;
  realtime: ChatInteractionRealtimePort;
  logger?: LoggerPort;
  metrics?: MetricsPort;
};

export const registerPollHandlers = ({
  socket,
  userId,
  limiter,
  realtime,
  logger = noopLogger.forComponent("socket"),
  metrics = noopMetrics,
}: PollHandlerDependencies): void => {
  socket.on(Events.VOTE_IN, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.VOTE_IN, voteEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { chatId, messageId, optionIndex } = parsedPayload;
    if (!(await enforceSocketEventLimits({
      socket,
      event: Events.VOTE_IN,
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
        event: Events.VOTE_IN,
        limiter,
        logger,
        metrics,
        policies: [SOCKET_EVENT_LIMITS.voteMessage],
        keyParts: [userId, authorizedMessage.id],
      }))) return;

      if (!authorizedMessage.pollId) return;

      await prisma.vote.create({
        data: {
          pollId: authorizedMessage.pollId,
          userId: socket.user.id,
          optionIndex,
        },
      });

      const payload: VoteInRealtimePayload = {
        messageId,
        optionIndex,
        user: {
          id: socket.user.id,
          avatar: socket.user.avatar,
          username: socket.user.username,
        },
        chatId,
      };
      realtime.emitVoteIn(chatId, payload);
    } catch (error) {
      recordUnexpectedSocketOperationFailure(metrics, "poll_vote", error);
      logSafeError(logger, "socket.poll_vote.failed", error, {
        operation: "poll_vote",
        result: "failed",
      });
    }
  });

  socket.on(Events.VOTE_OUT, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.VOTE_OUT, voteEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { chatId, messageId, optionIndex } = parsedPayload;
    if (!(await enforceSocketEventLimits({
      socket,
      event: Events.VOTE_OUT,
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
        event: Events.VOTE_OUT,
        limiter,
        logger,
        metrics,
        policies: [SOCKET_EVENT_LIMITS.voteMessage],
        keyParts: [userId, authorizedMessage.id],
      }))) return;

      if (!authorizedMessage.pollId) return;

      const vote = await prisma.vote.findFirst({
        where: {
          userId: socket.user.id,
          pollId: authorizedMessage.pollId,
          optionIndex,
        },
      });

      if (!vote) return;

      await prisma.vote.deleteMany({
        where: {
          userId: socket.user.id,
          pollId: authorizedMessage.pollId,
          optionIndex,
        },
      });
      const payload: VoteOutRealtimePayload = {
        chatId,
        messageId,
        optionIndex,
        userId: socket.user.id,
      };
      realtime.emitVoteOut(chatId, payload);
    } catch (error) {
      recordUnexpectedSocketOperationFailure(metrics, "poll_vote_remove", error);
      logSafeError(logger, "socket.poll_vote_removal.failed", error, {
        operation: "poll_vote_remove",
        result: "failed",
      });
    }
  });
};
