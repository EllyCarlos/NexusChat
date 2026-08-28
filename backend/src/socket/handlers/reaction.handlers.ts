import type { Server, Socket } from "socket.io";
import { Events } from "../../enums/event/event.enum.js";
import { prisma } from "../../lib/prisma.lib.js";
import {
  deleteReactionEventSchema,
  newReactionEventSchema,
} from "../../schemas/socket.schema.js";
import { assertMessageAccessible } from "../../services/authorization.service.js";
import { logServerError } from "../../utils/safe-logger.utils.js";
import {
  enforceSocketEventLimits,
  parseSocketPayload,
  SOCKET_EVENT_LIMITS,
  type SocketEventRateLimiter,
} from "../socket-security.js";

type NewReactionEventSendPayload = {
  chatId: string;
  messageId: string;
  user: {
    id: string;
    username: string;
    avatar: string;
  };
  reaction: string;
};

type DeleteReactionEventSendPayload = {
  chatId: string;
  messageId: string;
  userId: string;
};

type ReactionHandlerDependencies = {
  io: Server;
  socket: Socket;
  userId: string;
  limiter: SocketEventRateLimiter;
};

export const registerReactionHandlers = ({
  io,
  socket,
  userId,
  limiter,
}: ReactionHandlerDependencies): void => {
  socket.on(Events.NEW_REACTION, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.NEW_REACTION, newReactionEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { chatId, messageId, reaction } = parsedPayload;
    if (!enforceSocketEventLimits({
      socket,
      event: Events.NEW_REACTION,
      limiter,
      policies: [SOCKET_EVENT_LIMITS.mutationActor],
      keyParts: [userId],
    })) return;
    try {
      const authorizedMessage = await assertMessageAccessible(userId, chatId, messageId);
      if (!enforceSocketEventLimits({
        socket,
        event: Events.NEW_REACTION,
        limiter,
        policies: [SOCKET_EVENT_LIMITS.reactionMessage],
        keyParts: [userId, authorizedMessage.id],
      })) return;

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

      const payload: NewReactionEventSendPayload = {
        chatId,
        messageId,
        user: {
          id: socket.user.id,
          username: socket.user.username,
          avatar: socket.user.avatar,
        },
        reaction,
      };

      io.to(chatId).emit(Events.NEW_REACTION, payload);
    } catch (error) {
      logServerError("Socket reaction addition failed.", error);
    }
  });

  socket.on(Events.DELETE_REACTION, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.DELETE_REACTION, deleteReactionEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { chatId, messageId } = parsedPayload;
    if (!enforceSocketEventLimits({
      socket,
      event: Events.DELETE_REACTION,
      limiter,
      policies: [SOCKET_EVENT_LIMITS.mutationActor],
      keyParts: [userId],
    })) return;
    try {
      const authorizedMessage = await assertMessageAccessible(userId, chatId, messageId);
      if (!enforceSocketEventLimits({
        socket,
        event: Events.DELETE_REACTION,
        limiter,
        policies: [SOCKET_EVENT_LIMITS.reactionMessage],
        keyParts: [userId, authorizedMessage.id],
      })) return;

      await prisma.reactions.deleteMany({
        where: {
          userId: socket.user.id,
          messageId: authorizedMessage.id,
        },
      });
      const payload: DeleteReactionEventSendPayload = {
        chatId,
        messageId,
        userId: socket.user.id,
      };
      io.to(chatId).emit(Events.DELETE_REACTION, payload);
    } catch (error) {
      logServerError("Socket reaction deletion failed.", error);
    }
  });
};
