import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../../lib/prisma.lib.js";
import type { MessageReadRepository } from "../contracts/message-read.repository.js";
import type { ReadRepositoryPageInput } from "../contracts/read-query.types.js";

type MessageReadPrismaClient = Pick<PrismaClient, "message">;

export const messageListArguments = ({
  chatId,
  skip,
  take,
}: ReadRepositoryPageInput) => ({
  where: {
    chatId,
  },
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
  orderBy: {
    createdAt: "desc",
  },
  skip,
  take,
} as const satisfies Prisma.MessageFindManyArgs);

export const messageCountArguments = (chatId: string) => ({
  where: {
    chatId,
  },
} as const satisfies Prisma.MessageCountArgs);

export const createPrismaMessageReadRepository = (
  client: MessageReadPrismaClient,
): MessageReadRepository => ({
  listMessages: (input) => client.message.findMany(messageListArguments(input)),
  countMessages: (chatId) => client.message.count(messageCountArguments(chatId)),
});

export const prismaMessageReadRepository = createPrismaMessageReadRepository(prisma);
