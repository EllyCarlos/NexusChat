import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../../lib/prisma.lib.js";
import type { ChatRepository } from "../contracts/chat.repository.js";

type ChatPrismaClient = Pick<
  PrismaClient,
  "$transaction" | "chat" | "chatMembers" | "user"
>;

export const CHAT_MEMBER_PUBLIC_SELECT = {
  id: true,
  username: true,
  avatar: true,
  isOnline: true,
  publicKey: true,
  lastSeen: true,
  verificationBadge: true,
} as const satisfies Prisma.UserSelect;

const BASIC_CHAT_USER_SELECT = {
  id: true,
  username: true,
  avatar: true,
} as const satisfies Prisma.UserSelect;

const CHAT_MEMBERS_INCLUDE = {
  user: {
    select: CHAT_MEMBER_PUBLIC_SELECT,
  },
} as const satisfies Prisma.ChatMembersInclude;

const CHAT_MEMBERS_OMIT = {
  chatId: true,
  userId: true,
  id: true,
} as const satisfies Prisma.ChatMembersOmit;

const LATEST_MESSAGE_INCLUDE = {
  sender: {
    select: BASIC_CHAT_USER_SELECT,
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
        select: BASIC_CHAT_USER_SELECT,
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
} as const satisfies Prisma.MessageInclude;

export const createdGroupChatArguments = (
  chatId: string,
  viewerId: string,
) => ({
  where: {
    id: chatId,
  },
  omit: {
    avatarCloudinaryPublicId: true,
  },
  include: {
    ChatMembers: {
      include: CHAT_MEMBERS_INCLUDE,
      omit: CHAT_MEMBERS_OMIT,
    },
    UnreadMessages: {
      where: {
        userId: viewerId,
      },
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
          select: CHAT_MEMBER_PUBLIC_SELECT,
        },
      },
    },
    latestMessage: {
      include: LATEST_MESSAGE_INCLUDE,
    },
  },
}) as const satisfies Prisma.ChatFindUniqueArgs;

export const addedMembersChatArguments = (chatId: string) => ({
  where: {
    id: chatId,
  },
  omit: {
    avatarCloudinaryPublicId: true,
  },
  include: {
    ChatMembers: {
      include: CHAT_MEMBERS_INCLUDE,
      omit: CHAT_MEMBERS_OMIT,
    },
    latestMessage: {
      include: LATEST_MESSAGE_INCLUDE,
    },
  },
}) as const satisfies Prisma.ChatFindUniqueArgs;

export const createPrismaChatRepository = (
  client: ChatPrismaClient,
): ChatRepository => ({
  createGroupChatWithMembers: (input) => client.$transaction(async (transaction) => {
    const chat = await transaction.chat.create({
      data: {
        avatar: input.avatar,
        avatarCloudinaryPublicId: input.avatarCloudinaryPublicId,
        isGroupChat: true,
        adminId: input.actorId,
        name: input.name,
      },
      select: {
        id: true,
      },
    });

    await transaction.chatMembers.createMany({
      data: input.memberIds.map((userId) => ({
        chatId: chat.id,
        userId,
      })),
    });

    return chat;
  }),

  findCreatedGroupChat: (chatId, viewerId) => client.chat.findUnique(
    createdGroupChatArguments(chatId, viewerId),
  ),

  findExistingRequestedMemberUsernames: async (chatId, memberIds) => {
    const existingMembers = await client.chatMembers.findMany({
      where: {
        chatId,
        userId: {
          in: memberIds,
        },
      },
      include: {
        user: {
          select: {
            username: true,
          },
        },
      },
    });

    return existingMembers.map(({ user: { username } }) => username);
  },

  listMemberIdsForAddition: async (chatId) => {
    const members = await client.chatMembers.findMany({
      where: {
        chatId,
      },
      include: {
        user: {
          select: {
            id: true,
          },
        },
      },
    });

    return members.map(({ user: { id } }) => id);
  },

  addMembers: async (chatId, memberIds) => {
    await client.chatMembers.createMany({
      data: memberIds.map((userId) => ({
        chatId,
        userId,
      })),
    });
  },

  findMemberPublicDetails: (memberIds) => client.user.findMany({
    where: {
      id: {
        in: memberIds,
      },
    },
    select: CHAT_MEMBER_PUBLIC_SELECT,
  }),

  findChatForAddedMemberPayload: (chatId) => client.chat.findUnique(
    addedMembersChatArguments(chatId),
  ),

  listMemberIdsForRemoval: async (chatId) => {
    const members = await client.chatMembers.findMany({
      where: {
        chatId,
      },
    });

    return members.map(({ userId }) => userId);
  },

  updateAdmin: async (chatId, adminId) => {
    await client.chat.update({
      where: {
        id: chatId,
      },
      data: {
        adminId,
      },
    });
  },

  deleteMembers: async (chatId, memberIds) => {
    await client.chatMembers.deleteMany({
      where: {
        chatId,
        userId: {
          in: memberIds,
        },
      },
    });
  },

  updateGroupChat: (input) => client.chat.update({
    where: {
      id: input.chatId,
    },
    data: {
      ...(input.avatar ? {
        avatarCloudinaryPublicId: input.avatar.publicId,
        avatar: input.avatar.secureUrl,
      } : {}),
      ...(input.name ? {
        name: input.name,
      } : {}),
    },
    select: {
      name: true,
      avatar: true,
      id: true,
    },
  }),
});

export const prismaChatRepository = createPrismaChatRepository(prisma);
