import type { Prisma } from "@prisma/client";
import type { UploadApiResponse } from "cloudinary";
import type { Socket } from "socket.io";
import { Events } from "../../enums/event/event.enum.js";
import { prisma } from "../../lib/prisma.lib.js";
import { sendPushNotification } from "../../modules/notifications/push-notification.service.js";
import type { LoggerPort } from "../../observability/logger.port.js";
import { noopLogger } from "../../observability/noop-logger.js";
import { logSafeError } from "../../observability/safe-error.js";
import { messageEventSchema } from "../../schemas/socket.schema.js";
import {
  assertChatMember,
  assertMessageAccessible,
} from "../../services/authorization.service.js";
import {
  deleteFilesFromCloudinary,
  uploadAudioToCloudinary,
  uploadEncryptedAudioToCloudinary,
} from "../../utils/auth.util.js";
import type {
  MessageRealtimePayload,
  UnreadMessageRealtimePayload,
} from "../realtime/contracts/chat-realtime.types.js";
import type { MessageRealtimePort } from "../realtime/contracts/message-realtime.port.js";
import type { SocketEventRateLimitPort } from "../socket-event-rate-limit.port.js";
import {
  enforceSocketEventLimits,
  parseSocketPayload,
  SOCKET_EVENT_LIMITS,
} from "../socket-security.js";

type RegisterMessageHandlersInput = {
  socket: Socket;
  userId: string;
  limiter: SocketEventRateLimitPort;
  realtime: MessageRealtimePort;
  logger?: LoggerPort;
};

export const registerMessageHandlers = ({
  socket,
  userId,
  limiter,
  realtime,
  logger = noopLogger.forComponent("socket"),
}: RegisterMessageHandlersInput): void => {
  socket.on(Events.MESSAGE, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.MESSAGE, messageEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { chatId, isPollMessage, pollData, textMessageContent, url, encryptedAudio, audio, replyToMessageId } = parsedPayload;
    if (!(await enforceSocketEventLimits({
      socket,
      event: Events.MESSAGE,
      limiter,
      policies: [SOCKET_EVENT_LIMITS.messageActorBurst],
      keyParts: [userId],
    }))) return;

    try {

      await assertChatMember(userId, chatId);

      if (replyToMessageId) {
        await assertMessageAccessible(userId, chatId, replyToMessageId);
      }

      if (!(await enforceSocketEventLimits({
        socket,
        event: Events.MESSAGE,
        limiter,
        policies: [SOCKET_EVENT_LIMITS.messageChatBurst, SOCKET_EVENT_LIMITS.messageChatWindow],
        keyParts: [userId, chatId],
      }))) return;

      let newMessage: Partial<Prisma.MessageCreateInput>;

      if (audio) {
        const uploadResult = await uploadAudioToCloudinary({ buffer: audio }) as UploadApiResponse | undefined;
        if (!uploadResult) {
          logger.error("socket.audio_upload.failed", { result: "failed" });
          return;
        }
        try {
          newMessage = await prisma.message.create({
            data: {
              senderId: socket.user.id,
              chatId: chatId,
              isTextMessage: false,
              isPollMessage: false,
              audioPublicId: uploadResult.public_id,
              audioUrl: uploadResult.secure_url,
              replyToMessageId
            },
          })
        } catch (error) {
          await deleteFilesFromCloudinary({
            publicIds: [uploadResult.public_id],
            resourceType: "raw",
          });
          throw error;
        }
      }

      else if (encryptedAudio) {
        const uploadResult = (await uploadEncryptedAudioToCloudinary({ buffer: encryptedAudio })) as UploadApiResponse | undefined;
        if (!uploadResult) {
          logger.error("socket.encrypted_audio_upload.failed", { result: "failed" });
          return;
        }

        try {
          newMessage = await prisma.message.create({
            data: {
              senderId: socket.user.id,
              chatId: chatId,
              isTextMessage: false,
              isPollMessage: false,
              audioPublicId: uploadResult.public_id,
              audioUrl: uploadResult.secure_url,
              replyToMessageId
            },
          })
        } catch (error) {
          await deleteFilesFromCloudinary({
            publicIds: [uploadResult.public_id],
            resourceType: "raw",
          });
          throw error;
        }

      }

      else if (isPollMessage && pollData?.pollOptions && pollData.pollQuestion) {

        const newPoll = await prisma.poll.create({
          data: {
            question: pollData.pollQuestion,
            options: pollData.pollOptions,
            multipleAnswers: pollData.isMultipleAnswers ? pollData.isMultipleAnswers : false
          }
        })

        newMessage = await prisma.message.create({
          data: {
            senderId: socket.user.id,
            chatId: chatId,
            pollId: newPoll.id,
            isPollMessage: true,
            isTextMessage: false,
            replyToMessageId
          },
        })
      }
      else if (url) {
        newMessage = await prisma.message.create({
          data: {
            senderId: socket.user.id,
            chatId: chatId,
            url,
            isPollMessage: false,
            isTextMessage: false,
            replyToMessageId
          },
        })
      }
      else {
        newMessage = await prisma.message.create({
          data: {
            senderId: socket.user.id,
            chatId: chatId,
            isPollMessage: false,
            isTextMessage: true,
            textMessageContent: textMessageContent as string,
            replyToMessageId
          },
        })
      }

      const currentChat = await prisma.chat.update({
        where: { id: chatId },
        data: { latestMessageId: newMessage.id },
        include: {
          ChatMembers: {
            select: {
              user: {
                select: {
                  id: true,
                  isOnline: true,
                  notificationsEnabled: true,
                  fcmToken: true,
                }
              }
            }
          }
        }
      })

      const message = await prisma.message.findUnique({
        where: { chatId: chatId, id: newMessage.id },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              avatar: true,
            }
          },
          attachments: {
            select: {
              secureUrl: true,
            }
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
                      avatar: true
                    }
                  }
                },
                omit: {
                  id: true,
                  pollId: true,
                  userId: true,
                }
              },
            },
          },
          reactions: {
            select: {
              user: {
                select: {
                  id: true,
                  username: true,
                  avatar: true
                }
              },
              reaction: true,
            }
          },
          replyToMessage: {
            select: {
              sender: {
                select: {
                  id: true,
                  username: true,
                  avatar: true,
                }
              },
              id: true,
              textMessageContent: true,
              isPollMessage: true,
              url: true,
              audioUrl: true,
              attachments: {
                select: {
                  secureUrl: true
                }
              }
            }
          },
        },
        omit: {
          senderId: true,
          pollId: true,
          audioPublicId: true,
        },
      })

      // It's important to ensure 'message' is not null before using it.
      // Depending on the Prisma query result, 'message' could be null if no record is found.
      // Add a check here if 'message' is critical for the next steps.
      if (!message) {
        logger.error("socket.message_retrieval.failed", { result: "failed" });
        return;
      }

      const messagePayload: MessageRealtimePayload = { ...message, isNew: true }
      realtime.emitMessage(chatId, messagePayload)

      // Using non-null assertion (!) here since socket.user is confirmed to be defined above.
      const currentChatMembers = currentChat.ChatMembers.filter(({ user: { id } }) => id != socket.user!.id)

      const updateOrCreateUnreadMessagePromises = currentChatMembers.map(async (member) => {

        if (!member.user.isOnline && member.user.notificationsEnabled && member.user.fcmToken) {
          // Using non-null assertion (!) for socket.user.username here.
          sendPushNotification({ recipientToken: member.user.fcmToken, body: `New message from ${socket.user!.username}` })
        }

        const isExistingUnreadMessage = await prisma.unreadMessages.findUnique({
          where: {
            userId_chatId: {
              userId: member.user.id,
              chatId: chatId
            }
          }
        })

        if (isExistingUnreadMessage) {
          return prisma.unreadMessages.update({
            where: {
              userId_chatId: {
                userId: member.user.id,
                chatId: chatId
              }
            },
            data: {
              count: {
                increment: 1
              },
              messageId: newMessage.id
            }
          })
        }
        else {
          return prisma.unreadMessages.create({
            data: {
              userId: member.user.id,
              chatId: chatId,
              count: 1,
              // Using non-null assertion (!) for socket.user.id here.
              senderId: socket.user!.id,
              messageId: newMessage.id! // Using ! because newMessage.id should be defined after creation
            }
          })
        }
      })

      await Promise.all(updateOrCreateUnreadMessagePromises)

      const unreadMessagePayload: UnreadMessageRealtimePayload = {
        chatId: chatId,
        message: {
          textMessageContent: newMessage.isTextMessage ? newMessage.textMessageContent : undefined,
          url: newMessage.url ? true : false,
          attachments: false,
          poll: newMessage.isPollMessage ? true : false,
          audio: newMessage.audioPublicId ? true : false,
          createdAt: newMessage.createdAt as Date
        },
        sender: {
          // Using non-null assertion (!) for socket.user.id and avatar here.
          id: socket.user!.id,
          avatar: socket.user!.avatar!,
          username: socket.user!.username
        }
      }

      realtime.emitUnreadMessage(chatId, unreadMessagePayload)

    } catch (error) {
      logSafeError(logger, "socket.message_send.failed", error);
    }
  })
};
