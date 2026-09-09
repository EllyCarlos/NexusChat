import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../../lib/prisma.lib.js";
import type { MessageReadRepository } from "../contracts/message-read.repository.js";
import type {
  ReadMessageByIdInput,
  ReadMessageContextSideInput,
  ReadRepositoryPageInput,
} from "../contracts/read-query.types.js";

type MessageReadPrismaClient = Pick<PrismaClient, "message">;

export const messageReadInclude = {
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
} as const satisfies Prisma.MessageInclude;

export const messageReadOmit = {
  senderId: true,
  pollId: true,
} as const satisfies Prisma.MessageOmit;

export const messageListArguments = ({
  chatId,
  skip,
  take,
}: ReadRepositoryPageInput) => ({
  where: {
    chatId,
  },
  include: messageReadInclude,
  omit: messageReadOmit,
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

export const messageByIdArguments = ({
  actorUserId,
  chatId,
  messageId,
}: ReadMessageByIdInput) => ({
  where: {
    id: messageId,
    chatId,
    chat: {
      ChatMembers: {
        some: {
          userId: actorUserId,
        },
      },
    },
  },
  include: messageReadInclude,
  omit: messageReadOmit,
} as const satisfies Prisma.MessageFindFirstArgs);

export const messagesBeforeArguments = ({
  actorUserId,
  chatId,
  messageId,
  anchorCreatedAt,
  take,
}: ReadMessageContextSideInput) => ({
  where: {
    chatId,
    chat: {
      ChatMembers: {
        some: {
          userId: actorUserId,
        },
      },
    },
    OR: [
      { createdAt: { lt: anchorCreatedAt } },
      { createdAt: anchorCreatedAt, id: { lt: messageId } },
    ],
  },
  include: messageReadInclude,
  omit: messageReadOmit,
  orderBy: [
    { createdAt: "desc" },
    { id: "desc" },
  ],
  take,
} as const satisfies Prisma.MessageFindManyArgs);

export const messagesAfterArguments = ({
  actorUserId,
  chatId,
  messageId,
  anchorCreatedAt,
  take,
}: ReadMessageContextSideInput) => ({
  where: {
    chatId,
    chat: {
      ChatMembers: {
        some: {
          userId: actorUserId,
        },
      },
    },
    OR: [
      { createdAt: { gt: anchorCreatedAt } },
      { createdAt: anchorCreatedAt, id: { gt: messageId } },
    ],
  },
  include: messageReadInclude,
  omit: messageReadOmit,
  orderBy: [
    { createdAt: "asc" },
    { id: "asc" },
  ],
  take,
} as const satisfies Prisma.MessageFindManyArgs);

export const createPrismaMessageReadRepository = (
  client: MessageReadPrismaClient,
): MessageReadRepository => ({
  listMessages: (input) => client.message.findMany(messageListArguments(input)),
  countMessages: (chatId) => client.message.count(messageCountArguments(chatId)),
  findMessage: (input) => client.message.findFirst(messageByIdArguments(input)),
  listMessagesBefore: (input) => client.message.findMany(messagesBeforeArguments(input)),
  listMessagesAfter: (input) => client.message.findMany(messagesAfterArguments(input)),
});

export const prismaMessageReadRepository = createPrismaMessageReadRepository(prisma);
