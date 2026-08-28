import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../../lib/prisma.lib.js";
import type { ChatReadRepository } from "../contracts/chat-read.repository.js";

type ChatReadPrismaClient = Pick<PrismaClient, "chat">;

export const chatListArguments = (userId: string) => ({
  where: {
    ChatMembers: {
      some: {
        userId,
      },
    },
  },
  omit: {
    avatarCloudinaryPublicId: true,
  },
  include: {
    ChatMembers: {
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatar: true,
            isOnline: true,
            publicKey: true,
            lastSeen: true,
            verificationBadge: true,
          },
        },
      },
      omit: {
        chatId: true,
        userId: true,
        id: true,
      },
    },
    UnreadMessages: {
      select: {
        count: true,
        message: {
          select: {
            isTextMessage: true,
            url: true,
            attachments: {
              select: {
                secureUrl: true,
              },
            },
            isPollMessage: true,
            createdAt: true,
            textMessageContent: true,
          },
        },
        sender: {
          select: {
            id: true,
            username: true,
            avatar: true,
            isOnline: true,
            publicKey: true,
            lastSeen: true,
            verificationBadge: true,
          },
        },
      },
    },
    latestMessage: {
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
        poll: true,
        reactions: {
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
            createdAt: true,
            updatedAt: true,
            userId: true,
            messageId: true,
          },
        },
      },
    },
  },
} as const satisfies Prisma.ChatFindManyArgs);

export const createPrismaChatReadRepository = (
  client: ChatReadPrismaClient,
): ChatReadRepository => ({
  listChatsForUser: (userId) => client.chat.findMany(chatListArguments(userId)),
});

export const prismaChatReadRepository = createPrismaChatReadRepository(prisma);
