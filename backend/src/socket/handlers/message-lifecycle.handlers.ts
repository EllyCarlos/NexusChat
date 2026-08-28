import type { Server, Socket } from "socket.io";
import { Events } from "../../enums/event/event.enum.js";
import { prisma } from "../../lib/prisma.lib.js";
import {
    messageDeleteEventSchema,
    messageEditEventSchema,
    messageSeenEventSchema,
} from "../../schemas/socket.schema.js";
import { assertChatMember, assertMessageOwner } from "../../services/authorization.service.js";
import { deleteFilesFromCloudinary } from "../../utils/auth.util.js";
import { logServerError } from "../../utils/safe-logger.utils.js";
import {
    enforceSocketEventLimits,
    parseSocketPayload,
    SOCKET_EVENT_LIMITS,
    type SocketEventRateLimiter,
} from "../socket-security.js";

type MessageSeenEventSendPayload = {
    user: {
        id: string
        username: string
        avatar: string
    },
    chatId: string,
    readAt: Date
}

type MessageEditEventSendPayload = {
    chatId: string
    messageId: string
    updatedTextMessageContent: string
}

type MessageDeleteEventSendPayload = {
    chatId: string
    messageId: string
}

type RegisterMessageLifecycleHandlersArgs = {
    io: Server;
    socket: Socket;
    userId: string;
    limiter: SocketEventRateLimiter;
};

export const registerMessageLifecycleHandlers = ({
    io,
    socket,
    userId,
    limiter,
}: RegisterMessageLifecycleHandlersArgs): void => {
    socket.on(Events.MESSAGE_SEEN, async (rawPayload: unknown) => {
        const parsedPayload = parseSocketPayload(socket, Events.MESSAGE_SEEN, messageSeenEventSchema, rawPayload);
        if (!parsedPayload) return;
        const { chatId } = parsedPayload;
        if (!enforceSocketEventLimits({
            socket,
            event: Events.MESSAGE_SEEN,
            limiter,
            policies: [SOCKET_EVENT_LIMITS.seenActor],
            keyParts: [userId],
        })) return;

        try {
            await assertChatMember(userId, chatId);
            if (!enforceSocketEventLimits({
                socket,
                event: Events.MESSAGE_SEEN,
                limiter,
                policies: [SOCKET_EVENT_LIMITS.seenChat],
                keyParts: [userId, chatId],
            })) return;

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

            const payload: MessageSeenEventSendPayload = {
                user: {
                    // Using non-null assertion (!) for socket.user.id, username, and avatar here.
                    id: socket.user!.id,
                    username: socket.user!.username,
                    avatar: socket.user!.avatar!
                },
                chatId,
                readAt: unreadMessageData.readAt!,
            }
            io.to(chatId).emit(Events.MESSAGE_SEEN, payload)

        } catch (error) {
            logServerError('Socket mark-as-seen failed.', error)
        }
    })

    socket.on(Events.MESSAGE_EDIT, async (rawPayload: unknown) => {
        const parsedPayload = parseSocketPayload(socket, Events.MESSAGE_EDIT, messageEditEventSchema, rawPayload);
        if (!parsedPayload) return;
        const { chatId, messageId, updatedTextContent } = parsedPayload;
        if (!enforceSocketEventLimits({
            socket,
            event: Events.MESSAGE_EDIT,
            limiter,
            policies: [SOCKET_EVENT_LIMITS.mutationActor],
            keyParts: [userId],
        })) return;
        try {
            const authorizedMessage = await assertMessageOwner(userId, chatId, messageId);
            if (!enforceSocketEventLimits({
                socket,
                event: Events.MESSAGE_EDIT,
                limiter,
                policies: [SOCKET_EVENT_LIMITS.editMessage],
                keyParts: [userId, authorizedMessage.id],
            })) return;

            const message = await prisma.message.update({
                where: {
                    id: authorizedMessage.id
                },
                data: {
                    textMessageContent: updatedTextContent,
                    isEdited: true,
                }
            })

            const payload: MessageEditEventSendPayload = {
                updatedTextMessageContent: message.textMessageContent!, // Use ! as textMessageContent is expected to be non-null after update
                chatId,
                messageId
            }

            io.to(chatId).emit(Events.MESSAGE_EDIT, payload)
        } catch (error) {
            logServerError('Socket message edit failed.', error);
        }
    })

    socket.on(Events.MESSAGE_DELETE, async (rawPayload: unknown) => {
        const parsedPayload = parseSocketPayload(socket, Events.MESSAGE_DELETE, messageDeleteEventSchema, rawPayload);
        if (!parsedPayload) return;
        const { chatId, messageId } = parsedPayload;
        if (!enforceSocketEventLimits({
            socket,
            event: Events.MESSAGE_DELETE,
            limiter,
            policies: [SOCKET_EVENT_LIMITS.mutationActor],
            keyParts: [userId],
        })) return;

        try {
            const messageToBeDeleted = await assertMessageOwner(userId, chatId, messageId);
            if (!enforceSocketEventLimits({
                socket,
                event: Events.MESSAGE_DELETE,
                limiter,
                policies: [SOCKET_EVENT_LIMITS.deleteMessage],
                keyParts: [userId, messageToBeDeleted.id],
            })) return;

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
                const payload: MessageDeleteEventSendPayload = {
                    messageId: deletedMessage.id,
                    chatId,
                }
                io.to(chatId).emit(Events.MESSAGE_DELETE, payload)
            }
        } catch (error) {
            logServerError('Socket message deletion failed.', error);
        }
    })
};
