import { Prisma } from "@prisma/client";
import { UploadApiResponse } from "cloudinary";
import { Server, Socket } from "socket.io";
import { Events } from "../enums/event/event.enum.js";
import { prisma } from "../lib/prisma.lib.js";
import {
    deleteReactionEventSchema,
    messageDeleteEventSchema,
    messageEditEventSchema,
    messageEventSchema,
    messageSeenEventSchema,
    newReactionEventSchema,
    pinMessageEventSchema,
    unpinMessageEventSchema,
    userTypingEventSchema,
    voteEventSchema,
} from "../schemas/socket.schema.js";
import { assertChatMember, assertMessageAccessible, assertMessageOwner, assertPinAccessible } from "../services/authorization.service.js";
import { deleteFilesFromCloudinary, uploadAudioToCloudinary, uploadEncryptedAudioToCloudinary } from "../utils/auth.util.js";
import { sendPushNotification } from "../utils/generic.js";
import { logServerError } from "../utils/safe-logger.utils.js";
import {
    socketConnectionRegistry,
    socketPresenceWriteQueue,
    type SocketConnectionRegistry,
    type SocketPresenceWriteQueue,
} from "./connection-registry.js";
import {
    emitSocketSecurityError,
    enforceSocketEventLimits,
    parseSocketPayload,
    SOCKET_EVENT_LIMITS,
    socketEventRateLimiter,
    type SocketEventRateLimiter,
} from "./socket-security.js";
import registerWebRtcHandlers from "./webrtc/socket.js";

type UnreadMessageEventSendPayload = {
    chatId: string,
    message?: {
        textMessageContent?: string | undefined | null
        url?: boolean | undefined | null
        attachments?: boolean
        poll?: boolean
        createdAt: Date
        audio?: boolean
    },
    sender: {
        id: string,
        avatar: string,
        username: string
    }
}

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

type NewReactionEventSendPayload = {
    chatId: string
    messageId: string
    user: {
        id: string
        username: string
        avatar: string
    }
    reaction: string
}

type DeleteReactionEventSendPayload = {
    chatId: string
    messageId: string
    userId: string
}

type UserTypingEventSendPayload = {
    user: {
        id: string
        username: string
        avatar: string
    },
    chatId: string
}

type VoteInEventSendPayload = {
    messageId: string
    user: {
        id: string
        avatar: string
        username: string
    }
    optionIndex: number,
    chatId: string
}

type VoteOutEventSendPayload = {
    chatId: string
    messageId: string
    userId: string
    optionIndex: number
}

type OfflineUserEventSendPayload = {
    userId: string
}

type OnlineUserEventSendPayload = OfflineUserEventSendPayload

type OnlineUsersListEventSendPayload = {
    onlineUserIds: string[]
}

type UnpinMessageEventSendPayload = {
    pinId: string
    chatId: string
    messageId: string
}

type PinLimitReachedEventSendPayload = {
    oldestPinId: string
    messageId: string
    chatId: string
}

type SocketHandlerDependencies = {
    registry?: SocketConnectionRegistry;
    limiter?: SocketEventRateLimiter;
    presenceWriteQueue?: SocketPresenceWriteQueue;
};

const registerSocketHandlers = (
    io: Server,
    dependencies: SocketHandlerDependencies = {},
) => {
    const registry = dependencies.registry ?? socketConnectionRegistry;
    const limiter = dependencies.limiter ?? socketEventRateLimiter;
    const presenceWriteQueue = dependencies.presenceWriteQueue ?? socketPresenceWriteQueue;

    io.on("connection", async (socket: Socket) => {
        if (!socket.user) {
            socket.disconnect(true);
            return;
        }

        const userId = socket.user.id;
        const registration = registry.add(userId, socket.id);
        if (!registration.accepted) {
            emitSocketSecurityError(socket, "CONNECTION_LIMIT", "connection");
            socket.disconnect(true);
            return;
        }

        socket.on("disconnect", async () => {
            const removal = registry.remove(userId, socket.id);
            if (!removal.lastConnection) return;

            try {
                await presenceWriteQueue.run(userId, () => prisma.user.update({
                    where: { id: userId },
                    data: { isOnline: false, lastSeen: new Date() }
                }));
            } catch (error) {
                logServerError("Socket offline presence update failed.", error);
            }

            if (registry.isOnline(userId)) return;
            const payload: OfflineUserEventSendPayload = { userId };
            socket.broadcast.emit(Events.OFFLINE_USER, payload);
        });

        if (registration.firstConnection) {
            try {
                await presenceWriteQueue.run(userId, () => prisma.user.update({
                    where: { id: userId },
                    data: { isOnline: true }
                }));
            } catch (error) {
                logServerError("Socket online presence update failed.", error);
            }

            if (registry.isOnline(userId)) {
                const payload: OnlineUserEventSendPayload = { userId };
                socket.broadcast.emit(Events.ONLINE_USER, payload);
            }
        }

        const payloadOnlineUsers: OnlineUsersListEventSendPayload = {
            onlineUserIds: registry.onlineUserIds(),
        };
        socket.emit(Events.ONLINE_USERS_LIST, payloadOnlineUsers);

        try {
            const userChats = await prisma.chatMembers.findMany({
                where: { userId },
                select: { chatId: true }
            });
            socket.join(userChats.map(({ chatId }) => chatId));
        } catch (error) {
            logServerError("Socket room initialization failed.", error);
        }

        socket.on(Events.MESSAGE, async (rawPayload: unknown) => {
            const parsedPayload = parseSocketPayload(socket, Events.MESSAGE, messageEventSchema, rawPayload);
            if (!parsedPayload) return;
            const { chatId, isPollMessage, pollData, textMessageContent, url, encryptedAudio, audio, replyToMessageId } = parsedPayload;
            if (!enforceSocketEventLimits({
                socket,
                event: Events.MESSAGE,
                limiter,
                policies: [SOCKET_EVENT_LIMITS.messageActorBurst],
                keyParts: [userId],
            })) return;

            try {

                await assertChatMember(userId, chatId);

                if (replyToMessageId) {
                    await assertMessageAccessible(userId, chatId, replyToMessageId);
                }

                if (!enforceSocketEventLimits({
                    socket,
                    event: Events.MESSAGE,
                    limiter,
                    policies: [SOCKET_EVENT_LIMITS.messageChatBurst, SOCKET_EVENT_LIMITS.messageChatWindow],
                    keyParts: [userId, chatId],
                })) return;

                let newMessage: Partial<Prisma.MessageCreateInput>;

                if (audio) {
                    const uploadResult = await uploadAudioToCloudinary({ buffer: audio }) as UploadApiResponse | undefined;
                    if (!uploadResult) {
                        console.error("Audio upload failed.");
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
                        console.error("Encrypted audio upload failed.");
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
                    console.error("Failed to retrieve new message after creation.");
                    return;
                }

                io.to(chatId).emit(Events.MESSAGE, { ...message, isNew: true })

                // Using non-null assertion (!) here since socket.user is confirmed to be defined above.
                const currentChatMembers = currentChat.ChatMembers.filter(({ user: { id } }) => id != socket.user!.id)

                const updateOrCreateUnreadMessagePromises = currentChatMembers.map(async (member) => {

                    if (!member.user.isOnline && member.user.notificationsEnabled && member.user.fcmToken) {
                        // Using non-null assertion (!) for socket.user.username here.
                        sendPushNotification({ fcmToken: member.user.fcmToken, body: `New message from ${socket.user!.username}` })
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

                const unreadMessagePayload: UnreadMessageEventSendPayload = {
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

                io.to(chatId).emit(Events.UNREAD_MESSAGE, unreadMessagePayload)

            } catch (error) {
                logServerError('Socket message send failed.', error);
            }
        })

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
                        // Using non-null assertion (!) for socket.user.id here.
                        userId: socket.user!.id,
                        messageId: authorizedMessage.id
                    }
                })

                if (result) return;

                await prisma.reactions.create({
                    data: {
                        reaction,
                        // Using non-null assertion (!) for socket.user.id here.
                        userId: socket.user!.id,
                        messageId: authorizedMessage.id,
                    }
                })

                const payload: NewReactionEventSendPayload = {
                    chatId,
                    messageId,
                    user: {
                        // Using non-null assertion (!) for socket.user.id, username, and avatar here.
                        id: socket.user!.id,
                        username: socket.user!.username,
                        avatar: socket.user!.avatar!
                    },
                    reaction,
                }

                io.to(chatId).emit(Events.NEW_REACTION, payload)
            } catch (error) {
                logServerError('Socket reaction addition failed.', error);
            }

        })

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
                        // Using non-null assertion (!) for socket.user.id here.
                        userId: socket.user!.id,
                        messageId: authorizedMessage.id
                    }
                })
                const payload: DeleteReactionEventSendPayload = {
                    chatId,
                    messageId,
                    // Using non-null assertion (!) for socket.user.id here.
                    userId: socket.user!.id
                }
                io.to(chatId).emit(Events.DELETE_REACTION, payload)
            } catch (error) {
                logServerError('Socket reaction deletion failed.', error);
            }
        })

        socket.on(Events.USER_TYPING, async (rawPayload: unknown) => {
            const parsedPayload = parseSocketPayload(socket, Events.USER_TYPING, userTypingEventSchema, rawPayload);
            if (!parsedPayload) return;
            const { chatId } = parsedPayload;
            if (!enforceSocketEventLimits({
                socket,
                event: Events.USER_TYPING,
                limiter,
                policies: [SOCKET_EVENT_LIMITS.typingActor],
                keyParts: [userId],
            })) return;
            try {
                await assertChatMember(userId, chatId);
                if (!enforceSocketEventLimits({
                    socket,
                    event: Events.USER_TYPING,
                    limiter,
                    policies: [SOCKET_EVENT_LIMITS.typingChat],
                    keyParts: [userId, chatId],
                })) return;

                const payload: UserTypingEventSendPayload = {
                    user: {
                        // Using non-null assertion (!) for socket.user.id, username, and avatar here.
                        id: socket.user!.id,
                        username: socket.user!.username,
                        avatar: socket.user!.avatar!
                    },
                    chatId: chatId,
                }

                socket.broadcast.to(chatId).emit(Events.USER_TYPING, payload)
            } catch (error) {
                logServerError('Socket typing event failed.', error);
            }
        })

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

                if (!authorizedMessage.pollId) return

                await prisma.vote.create({
                    data: {
                        pollId: authorizedMessage.pollId,
                        // Using non-null assertion (!) for socket.user.id here.
                        userId: socket.user!.id,
                        optionIndex
                    }
                })

                const payload: VoteInEventSendPayload = {
                    messageId,
                    optionIndex,
                    user: {
                        // Using non-null assertion (!) for socket.user.id, avatar, and username here.
                        id: socket.user!.id,
                        avatar: socket.user!.avatar!,
                        username: socket.user!.username
                    },
                    chatId
                }
                io.to(chatId).emit(Events.VOTE_IN, payload)

            } catch (error) {
                logServerError('Socket poll vote failed.', error);
            }
        })

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

                if (!authorizedMessage.pollId) return

                const vote = await prisma.vote.findFirst({
                    where: {
                        // Using non-null assertion (!) for socket.user.id here.
                        userId: socket.user!.id,
                        pollId: authorizedMessage.pollId,
                        optionIndex
                    }
                })

                if (!vote) return;

                await prisma.vote.deleteMany({
                    where: {
                        // Using non-null assertion (!) for socket.user.id here.
                        userId: socket.user!.id,
                        pollId: authorizedMessage.pollId,
                        optionIndex
                    }
                });
                const payload: VoteOutEventSendPayload = {
                    chatId,
                    messageId,
                    optionIndex,
                    // Using non-null assertion (!) for socket.user.id here.
                    userId: socket.user!.id
                }
                io.to(chatId).emit(Events.VOTE_OUT, payload)

            } catch (error) {
                logServerError('Socket poll vote removal failed.', error);
            }
        })

        socket.on(Events.PIN_MESSAGE, async (rawPayload: unknown) => {
            const parsedPayload = parseSocketPayload(socket, Events.PIN_MESSAGE, pinMessageEventSchema, rawPayload);
            if (!parsedPayload) return;
            const { chatId, messageId } = parsedPayload;
            if (!enforceSocketEventLimits({
                socket,
                event: Events.PIN_MESSAGE,
                limiter,
                policies: [SOCKET_EVENT_LIMITS.mutationActor],
                keyParts: [userId],
            })) return;
            try {
                const authorizedMessage = await assertMessageAccessible(userId, chatId, messageId);
                if (!enforceSocketEventLimits({
                    socket,
                    event: Events.PIN_MESSAGE,
                    limiter,
                    policies: [SOCKET_EVENT_LIMITS.pinMessage],
                    keyParts: [userId, authorizedMessage.id],
                })) return;

                const pinnedMessages = await prisma.pinnedMessages.findMany({
                    where: { chatId },
                    orderBy: { createdAt: "asc" } // Get the oldest pinned message first
                });

                if (pinnedMessages.length === 3) {
                    await prisma.pinnedMessages.delete({ where: { id: pinnedMessages[0].id } });
                    const unpinnedMessage = await prisma.message.update({ where: { id: pinnedMessages[0].messageId }, data: { isPinned: false }, select: { id: true } });
                    const payload: PinLimitReachedEventSendPayload = {
                        oldestPinId: pinnedMessages[0].id,
                        messageId: unpinnedMessage.id,
                        chatId
                    }
                    io.to(chatId).emit(Events.PIN_LIMIT_REACHED, payload);
                }

                const pinnedMessage = await prisma.pinnedMessages.create({
                    data: {
                        messageId: authorizedMessage.id,
                        chatId
                    },
                    include: {
                        message: {
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
                                }
                            },
                            omit: {
                                senderId: true,
                                pollId: true,
                            },
                        }
                    },
                    omit: {
                        chatId: true,
                        messageId: true
                    }
                })
                await prisma.message.update({ where: { id: authorizedMessage.id }, data: { isPinned: true } });

                io.to(chatId).emit(Events.PIN_MESSAGE, pinnedMessage);
            } catch (error) {
                logServerError('Socket message pin failed.', error);
            }
        })

        socket.on(Events.UNPIN_MESSAGE, async (rawPayload: unknown) => {
            const parsedPayload = parseSocketPayload(socket, Events.UNPIN_MESSAGE, unpinMessageEventSchema, rawPayload);
            if (!parsedPayload) return;
            const { pinId } = parsedPayload;
            if (!enforceSocketEventLimits({
                socket,
                event: Events.UNPIN_MESSAGE,
                limiter,
                policies: [SOCKET_EVENT_LIMITS.mutationActor],
                keyParts: [userId],
            })) return;
            try {
                const authorizedPin = await assertPinAccessible(userId, pinId);
                if (!enforceSocketEventLimits({
                    socket,
                    event: Events.UNPIN_MESSAGE,
                    limiter,
                    policies: [SOCKET_EVENT_LIMITS.pinMessage],
                    keyParts: [userId, authorizedPin.messageId],
                })) return;

                const deletedPinnedMessage = await prisma.pinnedMessages.delete({
                    where: {
                        id: authorizedPin.id
                    },
                    select: {
                        id: true,
                        chatId: true,
                        messageId: true
                    }
                });

                await prisma.message.update({ where: { id: deletedPinnedMessage.messageId }, data: { isPinned: false } });

                const payload: UnpinMessageEventSendPayload = {
                    pinId: deletedPinnedMessage.id,
                    chatId: deletedPinnedMessage.chatId,
                    messageId: deletedPinnedMessage.messageId
                }
                io.to(deletedPinnedMessage.chatId).emit(Events.UNPIN_MESSAGE, payload);
            } catch (error) {
                    logServerError('Socket message unpin failed.', error);
            }
        })

        registerWebRtcHandlers(socket, io, { registry, limiter });
    })
}

export default registerSocketHandlers
