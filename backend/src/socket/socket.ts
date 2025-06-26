import { Prisma } from "@prisma/client";
import { UploadApiResponse } from "cloudinary";
import { Server, Socket } from "socket.io";
import { Events } from "../enums/event/event.enum.js";
import { userSocketIds } from "../index.js";
import { prisma } from "../lib/prisma.lib.js";
import { deleteFilesFromCloudinary, uploadAudioToCloudinary, uploadEncryptedAudioToCloudinary } from "../utils/auth.util.js";
import { sendPushNotification } from "../utils/generic.js";
import  registerWebRtcHandlers from "./webrtc/socket.js";

// IMPORTANT: Instead of extending the Socket interface locally, we augment the
// 'socket.io' module globally. This is the correct TypeScript approach
// to add custom properties to the Socket object provided by socket.io.
//
// You should create a file named, for example, `src/socket-io.d.ts`
// placed directly in your `src` directory with the following content,
// and ensure your `tsconfig.json` includes it.
//
// // src/socket-io.d.ts
// import { Socket } from "socket.io";
// import { Pr
//
// declare module "socket.io" {
//   interface Socket {
//     // The 'user' property's type has been updated to reflect the structure from your Prisma.UserCreateInput
//     /isma } from "@prisma/client";/ This ensures compatibility with properties like 'name' and 'email' which were previously missing.
//     user?: Omit<Prisma.UserCreateInput, "id" | "name" | "email" | "username"> &
//       Required<Pick<Prisma.UserCreateInput, "id" | "name" | "email" | "username">>;
//   }
// }
//
// With the above declaration file, the 'Socket' type will automatically include
// the 'user' property, resolving the type compatibility issues.

type MessageEventReceivePayload = {
    chatId: string
    isPollMessage: boolean
    textMessageContent?: string | ArrayBuffer
    encryptedAudio?: Uint8Array
    audio?: Uint8Array
    url?: string
    pollData?: {
        pollQuestion?: string
        pollOptions?: string[]
        isMultipleAnswers?: boolean
    },
    replyToMessageId?: string
}


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

type MessageSeenEventReceivePayload = {
    chatId: string
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

type MessageEditEventReceivePayload = {
    chatId: string
    messageId: string
    updatedTextContent: string
}

type MessageEditEventSendPayload = {
    chatId: string
    messageId: string
    updatedTextMessageContent: string
}

type MessageDeleteEventReceivePayload = {
    chatId: string
    messageId: string
}

type MessageDeleteEventSendPayload = MessageDeleteEventReceivePayload

type NewReactionEventReceivePayload = {
    chatId: string
    messageId: string
    reaction: string
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

type DeleteReactionEventReceivePayload = {
    chatId: string
    messageId: string
}

type DeleteReactionEventSendPayload = {
    chatId: string
    messageId: string
    userId: string
}

type UserTypingEventReceivePayload = {
    chatId: string
}

type UserTypingEventSendPayload = {
    user: {
        id: string
        username: string
        avatar: string
    },
    chatId: string
}

type VoteInEventReceivePayload = {
    chatId: string
    messageId: string
    optionIndex: number
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

type VoteOutEventReceivePayload = VoteInEventReceivePayload

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

type PinMessageEventReceivePayload = {
    chatId: string
    messageId: string
}

type UnpinMessageEventReceivePayload = {
    pinId: string
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

const registerSocketHandlers = (io: Server) => {

    // Now, 'socket: Socket' will implicitly include the 'user' property due to module augmentation.
    io.on("connection", async (socket: Socket) => {

        // Ensure socket.user is defined before proceeding.
        // If socket.user is not guaranteed to be set at this point in your authentication flow,
        // you should implement proper error handling or a redirection mechanism.
        // For the purpose of resolving TS18048, we'll assume it's set or will be set shortly.
        // If it can genuinely be undefined, add an early return:
        if (!socket.user) {
            console.error("Socket user is undefined on connection, disconnecting socket.");
            socket.disconnect(true); // Disconnect if user is not attached
            return;
        }

        console.log(socket.user.username, "connected");

        await prisma.user.update({
            where: { id: socket.user.id },
            data: { isOnline: true }
        })

        userSocketIds.set(socket.user.id, socket.id)

        // telling everyone that user is online
        const payload: OnlineUserEventSendPayload = {
            userId: socket.user.id
        }
        socket.broadcast.emit(Events.ONLINE_USER, payload)

        // getting all other online users
        const onlineUserIds = Array.from(userSocketIds.keys());

        // sending the online users to the user who just connected
        let payloadOnlineUsers: OnlineUsersListEventSendPayload = {
            onlineUserIds,
        }
        socket.emit(Events.ONLINE_USERS_LIST, payloadOnlineUsers);

        // getting all chats of the user
        const userChats = await prisma.chatMembers.findMany({
            where: {
                userId: socket.user.id
            },
            select: { chatId: true }
        })

        // joining the user to all of its chats via chatIds (i.e rooms)
        const chatIds = userChats.map(({ chatId }) => chatId);
        socket.join(chatIds)

        socket.on(Events.MESSAGE, async ({ chatId, isPollMessage, pollData, textMessageContent, url, encryptedAudio, audio, replyToMessageId }: MessageEventReceivePayload) => {

            try {

                let newMessage: Partial<Prisma.MessageCreateInput>;

                if (audio) {
                    const uploadResult = await uploadAudioToCloudinary({ buffer: audio }) as UploadApiResponse | undefined;
                    if (!uploadResult) {
                        console.error("Audio upload failed.");
                        return;
                    }
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
                }

                else if (encryptedAudio) {
                    const uploadResult = (await uploadEncryptedAudioToCloudinary({ buffer: encryptedAudio })) as UploadApiResponse | undefined;
                    if (!uploadResult) {
                        console.error("Encrypted audio upload failed.");
                        return;
                    }

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
                console.log('Error sending message:', error);
            }
        })

        socket.on(Events.MESSAGE_SEEN, async ({ chatId }: MessageSeenEventReceivePayload) => {

            try {
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
                console.log('Error marking message as seen:', error)
            }
        })

        socket.on(Events.MESSAGE_EDIT, async ({ chatId, messageId, updatedTextContent }: MessageEditEventReceivePayload) => {
            try {
                const message = await prisma.message.update({
                    where: {
                        chatId,
                        id: messageId
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
                console.log('Error editing message:', error);
            }
        })

        socket.on(Events.MESSAGE_DELETE, async ({ chatId, messageId }: MessageDeleteEventReceivePayload) => {

            try {
                await prisma.pinnedMessages.deleteMany({ where: { messageId } });

                // if this message had any replies, then breaking the connection of the replies with this message
                // and this message will be deleted
                await prisma.message.updateMany({
                    where: { replyToMessageId: messageId },
                    data: { replyToMessageId: null },
                });


                // deleting unreadMessages of this message
                await prisma.unreadMessages.deleteMany({ where: { messageId } });

                // deleting reactions of this message
                await prisma.reactions.deleteMany({ where: { messageId } });


                const messageToBeDeleted = await prisma.message.findUnique({
                    where: { chatId, id: messageId },
                    select: { audioPublicId: true, attachments: { select: { cloudinaryPublicId: true } } }
                });

                if (!messageToBeDeleted) return;

                let publicIds: string[] = [];

                // Delete files from Cloudinary first
                if (messageToBeDeleted?.attachments.length) {
                    console.log('deleting attachments from Cloudinary');
                    const cloudinaryPublicIdsOfAttachments = messageToBeDeleted?.attachments.map(({ cloudinaryPublicId }) => cloudinaryPublicId);
                    publicIds.push(...cloudinaryPublicIdsOfAttachments);
                    await prisma.attachment.deleteMany({ where: { messageId } });
                }

                if (messageToBeDeleted?.audioPublicId) {
                    console.log('deleting audio from Cloudinary');
                    publicIds.push(messageToBeDeleted.audioPublicId);
                }

                if (publicIds.length) {
                    await deleteFilesFromCloudinary({ publicIds });
                }

                // Now safely delete the original message
                const deletedMessage = await prisma.message.delete({
                    where: { id: messageId },
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
                console.log('Error deleting message:', error);
            }
        })

        socket.on(Events.NEW_REACTION, async ({ chatId, messageId, reaction }: NewReactionEventReceivePayload) => {
            try {
                const result = await prisma.reactions.findFirst({
                    where: {
                        // Using non-null assertion (!) for socket.user.id here.
                        userId: socket.user!.id,
                        messageId
                    }
                })

                if (result) return;

                await prisma.reactions.create({
                    data: {
                        reaction,
                        // Using non-null assertion (!) for socket.user.id here.
                        userId: socket.user!.id,
                        messageId,
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
                console.log('Error adding reaction:', error);
            }

        })

        socket.on(Events.DELETE_REACTION, async ({ chatId, messageId }: DeleteReactionEventReceivePayload) => {
            try {
                await prisma.reactions.deleteMany({
                    where: {
                        // Using non-null assertion (!) for socket.user.id here.
                        userId: socket.user!.id,
                        messageId
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
                console.log('Error deleting reaction:', error);
            }
        })

        socket.on(Events.USER_TYPING, ({ chatId }: UserTypingEventReceivePayload) => {
            try {
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
                console.log('Error user typing:', error);
            }
        })

        socket.on(Events.VOTE_IN, async ({ chatId, messageId, optionIndex }: VoteInEventReceivePayload) => {
            console.log('vote in received');

            try {
                const isValidPoll = await prisma.message.findFirst({
                    where: { chatId, id: messageId },
                    include: {
                        poll: {
                            select: {
                                id: true
                            }
                        }
                    }
                })

                if (!isValidPoll?.poll?.id) return

                await prisma.vote.create({
                    data: {
                        pollId: isValidPoll.poll.id,
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
                console.log('error in vote in:', error);
            }
        })

        socket.on(Events.VOTE_OUT, async ({ chatId, messageId, optionIndex }: VoteOutEventReceivePayload) => {
            console.log('vote out received');

            try {
                const isValidPoll = await prisma.message.findFirst({
                    where: { chatId, id: messageId },
                    include: {
                        poll: {
                            select: {
                                id: true
                            }
                        }
                    },
                })

                if (!isValidPoll?.poll?.id) return

                const vote = await prisma.vote.findFirst({
                    where: {
                        // Using non-null assertion (!) for socket.user.id here.
                        userId: socket.user!.id,
                        pollId: isValidPoll.poll.id,
                        optionIndex
                    }
                })

                if (!vote) return;

                await prisma.vote.deleteMany({
                    where: {
                        // Using non-null assertion (!) for socket.user.id here.
                        userId: socket.user!.id,
                        pollId: isValidPoll.poll.id,
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
                console.log('error in vote out:', error);
            }
        })

        socket.on(Events.PIN_MESSAGE, async ({ chatId, messageId }: PinMessageEventReceivePayload) => {
            try {
                console.log('messageId for pinning message is:', messageId);
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
                        messageId,
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
                await prisma.message.update({ where: { id: messageId }, data: { isPinned: true } });

                io.to(chatId).emit(Events.PIN_MESSAGE, pinnedMessage);
            } catch (error) {
                console.log('error pinning message:', error);
            }
        })

        socket.on(Events.UNPIN_MESSAGE, async ({ pinId }: UnpinMessageEventReceivePayload) => {
            try {
                const deletedPinnedMessage = await prisma.pinnedMessages.delete({
                    where: {
                        id: pinId
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
                    console.log('error un-pinning message:', error);
            }
        })

        // The registerWebRtcHandlers function will also benefit from the global module augmentation
        // for the Socket type, resolving TS18048 errors in that file as well.
        registerWebRtcHandlers(socket, io);

        socket.on("disconnect", async () => {
            // Check if socket.user is defined before accessing its properties during disconnect
            if (!socket.user) {
                console.warn("Socket user was undefined during disconnect event.");
                return;
            }

            await prisma.user.update({
                where: {
                    // Using non-null assertion (!) for socket.user.id here.
                    id: socket.user!.id
                },
                data: {
                    isOnline: false,
                    lastSeen: new Date
                }
            })
            // Using non-null assertion (!) for socket.user.id here.
            userSocketIds.delete(socket.user!.id);

            const payload: OfflineUserEventSendPayload = {
                // Using non-null assertion (!) for socket.user.id here.
                userId: socket.user!.id
            }
            socket.broadcast.emit(Events.OFFLINE_USER, payload)
        })
    })
}

export default registerSocketHandlers
