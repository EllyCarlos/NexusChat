import type { Socket } from "socket.io";
import { Events } from "../../enums/event/event.enum.js";
import { prisma } from "../../lib/prisma.lib.js";
import {
  pinMessageEventSchema,
  unpinMessageEventSchema,
} from "../../schemas/socket.schema.js";
import {
  assertMessageAccessible,
  assertPinAccessible,
} from "../../services/authorization.service.js";
import type { LoggerPort } from "../../observability/logger.port.js";
import { noopLogger } from "../../observability/noop-logger.js";
import { logSafeError } from "../../observability/safe-error.js";
import type { SocketEventRateLimitPort } from "../socket-event-rate-limit.port.js";
import {
  enforceSocketEventLimits,
  parseSocketPayload,
  SOCKET_EVENT_LIMITS,
} from "../socket-security.js";
import type {
  PinLimitReachedRealtimePayload,
  UnpinMessageRealtimePayload,
} from "../realtime/contracts/chat-realtime.types.js";
import type { ChatInteractionRealtimePort } from "../realtime/contracts/interaction-realtime.port.js";

type PinHandlerDependencies = {
  socket: Socket;
  userId: string;
  limiter: SocketEventRateLimitPort;
  realtime: ChatInteractionRealtimePort;
  logger?: LoggerPort;
};

export const registerPinHandlers = ({
  socket,
  userId,
  limiter,
  realtime,
  logger = noopLogger.forComponent("socket"),
}: PinHandlerDependencies): void => {
  socket.on(Events.PIN_MESSAGE, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.PIN_MESSAGE, pinMessageEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { chatId, messageId } = parsedPayload;
    if (!(await enforceSocketEventLimits({
      socket,
      event: Events.PIN_MESSAGE,
      limiter,
      policies: [SOCKET_EVENT_LIMITS.mutationActor],
      keyParts: [userId],
    }))) return;
    try {
      const authorizedMessage = await assertMessageAccessible(userId, chatId, messageId);
      if (!(await enforceSocketEventLimits({
        socket,
        event: Events.PIN_MESSAGE,
        limiter,
        policies: [SOCKET_EVENT_LIMITS.pinMessage],
        keyParts: [userId, authorizedMessage.id],
      }))) return;

      const pinnedMessages = await prisma.pinnedMessages.findMany({
        where: { chatId },
        orderBy: { createdAt: "asc" },
      });

      if (pinnedMessages.length === 3) {
        await prisma.pinnedMessages.delete({ where: { id: pinnedMessages[0].id } });
        const unpinnedMessage = await prisma.message.update({
          where: { id: pinnedMessages[0].messageId },
          data: { isPinned: false },
          select: { id: true },
        });
        const payload: PinLimitReachedRealtimePayload = {
          oldestPinId: pinnedMessages[0].id,
          messageId: unpinnedMessage.id,
          chatId,
        };
        realtime.emitPinLimitReached(chatId, payload);
      }

      const pinnedMessage = await prisma.pinnedMessages.create({
        data: {
          messageId: authorizedMessage.id,
          chatId,
        },
        include: {
          message: {
            include: {
              sender: {
                select: {
                  id: true,
                  username: true,
                  avatar: true,
                },
              },
              attachments: {
                select: {
                  secureUrl: true,
                },
              },
              poll: {
                omit: {
                  id: true,
                },
                include: {
                  votes: {
                    include: {
                      user: {
                        select: {
                          id: true,
                          username: true,
                          avatar: true,
                        },
                      },
                    },
                    omit: {
                      id: true,
                      pollId: true,
                      userId: true,
                    },
                  },
                },
              },
              reactions: {
                select: {
                  user: {
                    select: {
                      id: true,
                      username: true,
                      avatar: true,
                    },
                  },
                  reaction: true,
                },
              },
              replyToMessage: {
                select: {
                  sender: {
                    select: {
                      id: true,
                      username: true,
                      avatar: true,
                    },
                  },
                  id: true,
                  textMessageContent: true,
                  isPollMessage: true,
                  url: true,
                  audioUrl: true,
                  attachments: {
                    select: {
                      secureUrl: true,
                    },
                  },
                },
              },
            },
            omit: {
              senderId: true,
              pollId: true,
            },
          },
        },
        omit: {
          chatId: true,
          messageId: true,
        },
      });
      await prisma.message.update({
        where: { id: authorizedMessage.id },
        data: { isPinned: true },
      });

      realtime.emitPinMessage(chatId, pinnedMessage);
    } catch (error) {
      logSafeError(logger, "socket.message_pin.failed", error);
    }
  });

  socket.on(Events.UNPIN_MESSAGE, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.UNPIN_MESSAGE, unpinMessageEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { pinId } = parsedPayload;
    if (!(await enforceSocketEventLimits({
      socket,
      event: Events.UNPIN_MESSAGE,
      limiter,
      policies: [SOCKET_EVENT_LIMITS.mutationActor],
      keyParts: [userId],
    }))) return;
    try {
      const authorizedPin = await assertPinAccessible(userId, pinId);
      if (!(await enforceSocketEventLimits({
        socket,
        event: Events.UNPIN_MESSAGE,
        limiter,
        policies: [SOCKET_EVENT_LIMITS.pinMessage],
        keyParts: [userId, authorizedPin.messageId],
      }))) return;

      const deletedPinnedMessage = await prisma.pinnedMessages.delete({
        where: {
          id: authorizedPin.id,
        },
        select: {
          id: true,
          chatId: true,
          messageId: true,
        },
      });

      await prisma.message.update({
        where: { id: deletedPinnedMessage.messageId },
        data: { isPinned: false },
      });

      const payload: UnpinMessageRealtimePayload = {
        pinId: deletedPinnedMessage.id,
        chatId: deletedPinnedMessage.chatId,
        messageId: deletedPinnedMessage.messageId,
      };
      realtime.emitUnpinMessage(deletedPinnedMessage.chatId, payload);
    } catch (error) {
      logSafeError(logger, "socket.message_unpin.failed", error);
    }
  });
};
