import type { Socket } from "socket.io";
import { Events } from "../../enums/event/event.enum.js";
import { prisma } from "../../lib/prisma.lib.js";
import {
    messageDeleteEventSchema,
    messageEditEventSchema,
    messageSeenEventSchema,
} from "../../schemas/socket.schema.js";
import { assertChatMember, assertMessageOwner } from "../../services/authorization.service.js";
import type { LoggerPort } from "../../observability/logger.port.js";
import { noopLogger } from "../../observability/noop-logger.js";
import { logSafeError } from "../../observability/safe-error.js";
import { deleteFilesFromCloudinary } from "../../utils/auth.util.js";
import type {
    MessageDeleteRealtimePayload,
    MessageEditRealtimePayload,
    MessageSeenRealtimePayload,
} from "../realtime/contracts/chat-realtime.types.js";
import type { MessageRealtimePort } from "../realtime/contracts/message-realtime.port.js";
import type { SocketEventRateLimitPort } from "../socket-event-rate-limit.port.js";
import {
    enforceSocketEventLimits,
    parseSocketPayload,
    SOCKET_EVENT_LIMITS,
} from "../socket-security.js";

type RegisterMessageLifecycleHandlersArgs = {
    socket: Socket;
    userId: string;
    limiter: SocketEventRateLimitPort;
    realtime: MessageRealtimePort;
    logger?: LoggerPort;
};

export const registerMessageLifecycleHandlers = ({
    socket,
    userId,
    limiter,
    realtime,
    logger = noopLogger.forComponent("socket"),
}: RegisterMessageLifecycleHandlersArgs): void => {
    socket.on(Events.MESSAGE_SEEN, async (rawPayload: unknown) => {
        const parsedPayload = parseSocketPayload(socket, Events.MESSAGE_SEEN, messageSeenEventSchema, rawPayload);
        if (!parsedPayload) return;
        const { chatId } = parsedPayload;
        if (!(await enforceSocketEventLimits({
            socket,
            event: Events.MESSAGE_SEEN,
            limiter,
            policies: [SOCKET_EVENT_LIMITS.seenActor],
            keyParts: [userId],
        }))) return;

        try {
            await assertChatMember(userId, chatId);
            if (!(await enforceSocketEventLimits({
                socket,
                event: Events.MESSAGE_SEEN,
                limiter,
                policies: [SOCKET_EVENT_LIMITS.seenChat],
                keyParts: [userId, chatId],
            }))) return;

            const doesUnreadMessageExists = await prisma.unreadMessages.findUnique({
                where: {
                    userId_chatId: {
                        // Using non-null assertion (!) for socket.user.id here.
                        userId: socket.user!.id,
                        chatId,
                    }
                }
            })

            if (!doesUnreadMessageExists) return;
            const unreadMessageData = await prisma.unreadMessages.update({
                where: {
                    id: doesUnreadMessageExists.id
                },
                data: {
                    count: 0,
                    readAt: new Date
                }
            })

            const payload: MessageSeenRealtimePayload = {
                user: {
                    // Using non-null assertion (!) for socket.user.id, username, and avatar here.
                    id: socket.user!.id,
                    username: socket.user!.username,
                    avatar: socket.user!.avatar!
                },
                chatId,
                readAt: unreadMessageData.readAt!,
            }
            realtime.emitMessageSeen(chatId, payload)

        } catch (error) {
            logSafeError(logger, "socket.message_seen.failed", error)
        }
    })

    socket.on(Events.MESSAGE_EDIT, async (rawPayload: unknown) => {
        const parsedPayload = parseSocketPayload(socket, Events.MESSAGE_EDIT, messageEditEventSchema, rawPayload);
        if (!parsedPayload) return;
        const { chatId, messageId, updatedTextContent } = parsedPayload;
        if (!(await enforceSocketEventLimits({
            socket,
            event: Events.MESSAGE_EDIT,
            limiter,
            policies: [SOCKET_EVENT_LIMITS.mutationActor],
            keyParts: [userId],
        }))) return;
        try {
            const authorizedMessage = await assertMessageOwner(userId, chatId, messageId);
            if (!(await enforceSocketEventLimits({
                socket,
                event: Events.MESSAGE_EDIT,
                limiter,
                policies: [SOCKET_EVENT_LIMITS.editMessage],
                keyParts: [userId, authorizedMessage.id],
            }))) return;

            const message = await prisma.message.update({
                where: {
                    id: authorizedMessage.id
                },
                data: {
                    textMessageContent: updatedTextContent,
                    isEdited: true,
                }
            })

            const payload: MessageEditRealtimePayload = {
                updatedTextMessageContent: message.textMessageContent!, // Use ! as textMessageContent is expected to be non-null after update
                chatId,
                messageId
            }

            realtime.emitMessageEdit(chatId, payload)
        } catch (error) {
            logSafeError(logger, "socket.message_edit.failed", error);
        }
    })

    socket.on(Events.MESSAGE_DELETE, async (rawPayload: unknown) => {
        const parsedPayload = parseSocketPayload(socket, Events.MESSAGE_DELETE, messageDeleteEventSchema, rawPayload);
        if (!parsedPayload) return;
        const { chatId, messageId } = parsedPayload;
        if (!(await enforceSocketEventLimits({
            socket,
            event: Events.MESSAGE_DELETE,
            limiter,
            policies: [SOCKET_EVENT_LIMITS.mutationActor],
            keyParts: [userId],
        }))) return;

        try {
            const messageToBeDeleted = await assertMessageOwner(userId, chatId, messageId);
            if (!(await enforceSocketEventLimits({
                socket,
                event: Events.MESSAGE_DELETE,
                limiter,
                policies: [SOCKET_EVENT_LIMITS.deleteMessage],
                keyParts: [userId, messageToBeDeleted.id],
            }))) return;

            await prisma.pinnedMessages.deleteMany({ where: { messageId: messageToBeDeleted.id } });

            // if this message had any replies, then breaking the connection of the replies with this message
            // and this message will be deleted
            await prisma.message.updateMany({
                where: { replyToMessageId: messageToBeDeleted.id },
                data: { replyToMessageId: null },
            });


            // deleting unreadMessages of this message
            await prisma.unreadMessages.deleteMany({ where: { messageId: messageToBeDeleted.id } });

            // deleting reactions of this message
            await prisma.reactions.deleteMany({ where: { messageId: messageToBeDeleted.id } });

            const attachmentPublicIds: string[] = [];

            // Delete files from Cloudinary first
            if (messageToBeDeleted?.attachments.length) {
                const cloudinaryPublicIdsOfAttachments = messageToBeDeleted?.attachments.map(({ cloudinaryPublicId }) => cloudinaryPublicId);
                attachmentPublicIds.push(...cloudinaryPublicIdsOfAttachments);
                await prisma.attachment.deleteMany({ where: { messageId: messageToBeDeleted.id } });
            }

            if (attachmentPublicIds.length) {
                await deleteFilesFromCloudinary({ publicIds: attachmentPublicIds });
            }

            if (messageToBeDeleted?.audioPublicId) {
                await deleteFilesFromCloudinary({
                    publicIds: [messageToBeDeleted.audioPublicId],
                    resourceType: "raw",
                });
            }

            // Now safely delete the original message
            const deletedMessage = await prisma.message.delete({
                where: { id: messageToBeDeleted.id },
                select: { id: true }
            });

            if (deletedMessage.id) {
                const payload: MessageDeleteRealtimePayload = {
                    messageId: deletedMessage.id,
                    chatId,
                }
                realtime.emitMessageDelete(chatId, payload)
            }
        } catch (error) {
            logSafeError(logger, "socket.message_delete.failed", error);
        }
    })
};
