import type { Server, Socket } from "socket.io";
import { Events } from "../../enums/event/event.enum.js";
import { prisma } from "../../lib/prisma.lib.js";
import { voteEventSchema } from "../../schemas/socket.schema.js";
import { assertMessageAccessible } from "../../services/authorization.service.js";
import { logServerError } from "../../utils/safe-logger.utils.js";
import {
  enforceSocketEventLimits,
  parseSocketPayload,
  SOCKET_EVENT_LIMITS,
  type SocketEventRateLimiter,
} from "../socket-security.js";

type VoteInEventSendPayload = {
  messageId: string;
  user: {
    id: string;
    avatar: string;
    username: string;
  };
  optionIndex: number;
  chatId: string;
};

type VoteOutEventSendPayload = {
  chatId: string;
  messageId: string;
  userId: string;
  optionIndex: number;
};

type PollHandlerDependencies = {
  io: Server;
  socket: Socket;
  userId: string;
  limiter: SocketEventRateLimiter;
};

export const registerPollHandlers = ({
  io,
  socket,
  userId,
  limiter,
}: PollHandlerDependencies): void => {
  socket.on(Events.VOTE_IN, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.VOTE_IN, voteEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { chatId, messageId, optionIndex } = parsedPayload;
    if (!enforceSocketEventLimits({
      socket,
      event: Events.VOTE_IN,
      limiter,
      policies: [SOCKET_EVENT_LIMITS.mutationActor],
      keyParts: [userId],
    })) return;

    try {
      const authorizedMessage = await assertMessageAccessible(userId, chatId, messageId);
      if (!enforceSocketEventLimits({
        socket,
        event: Events.VOTE_IN,
        limiter,
        policies: [SOCKET_EVENT_LIMITS.voteMessage],
        keyParts: [userId, authorizedMessage.id],
      })) return;

      if (!authorizedMessage.pollId) return;

      await prisma.vote.create({
        data: {
          pollId: authorizedMessage.pollId,
          userId: socket.user.id,
          optionIndex,
        },
      });

      const payload: VoteInEventSendPayload = {
        messageId,
        optionIndex,
        user: {
          id: socket.user.id,
          avatar: socket.user.avatar,
          username: socket.user.username,
        },
        chatId,
      };
      io.to(chatId).emit(Events.VOTE_IN, payload);
    } catch (error) {
      logServerError("Socket poll vote failed.", error);
    }
  });

  socket.on(Events.VOTE_OUT, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.VOTE_OUT, voteEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { chatId, messageId, optionIndex } = parsedPayload;
    if (!enforceSocketEventLimits({
      socket,
      event: Events.VOTE_OUT,
      limiter,
      policies: [SOCKET_EVENT_LIMITS.mutationActor],
      keyParts: [userId],
    })) return;

    try {
      const authorizedMessage = await assertMessageAccessible(userId, chatId, messageId);
      if (!enforceSocketEventLimits({
        socket,
        event: Events.VOTE_OUT,
        limiter,
        policies: [SOCKET_EVENT_LIMITS.voteMessage],
        keyParts: [userId, authorizedMessage.id],
      })) return;

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
      const payload: VoteOutEventSendPayload = {
        chatId,
        messageId,
        optionIndex,
        userId: socket.user.id,
      };
      io.to(chatId).emit(Events.VOTE_OUT, payload);
    } catch (error) {
      logServerError("Socket poll vote removal failed.", error);
    }
  });
};
