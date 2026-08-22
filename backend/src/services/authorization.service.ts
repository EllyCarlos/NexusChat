import { Prisma } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "../lib/prisma.lib.js";
import { CustomError } from "../utils/error.utils.js";

const authorizedChatSelect = {
  id: true,
  isGroupChat: true,
  adminId: true,
  avatarCloudinaryPublicId: true,
  ChatMembers: {
    select: {
      userId: true,
    },
  },
} satisfies Prisma.ChatSelect;

export type AuthorizedChat = Prisma.ChatGetPayload<{
  select: typeof authorizedChatSelect;
}>;

const authorizedMessageSelect = {
  id: true,
  chatId: true,
  senderId: true,
  pollId: true,
  audioPublicId: true,
  attachments: {
    select: {
      cloudinaryPublicId: true,
    },
  },
} satisfies Prisma.MessageSelect;

export type AuthorizedMessage = Prisma.MessageGetPayload<{
  select: typeof authorizedMessageSelect;
}>;

const authorizedPinSelect = {
  id: true,
  chatId: true,
  messageId: true,
} satisfies Prisma.PinnedMessagesSelect;

export type AuthorizedPin = Prisma.PinnedMessagesGetPayload<{
  select: typeof authorizedPinSelect;
}>;

const authorizedChatKey: unique symbol = Symbol("authorizedChat");

type RequestWithAuthorizedChat = Request & {
  [authorizedChatKey]?: AuthorizedChat;
};

export const assertChatMember = async (
  actorUserId: string,
  chatId: string,
): Promise<AuthorizedChat> => {
  if (!actorUserId) {
    throw new CustomError("Authentication is required", 401);
  }

  if (!chatId?.trim()) {
    throw new CustomError("ChatId is required", 400);
  }

  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      ChatMembers: {
        some: {
          userId: actorUserId,
        },
      },
    },
    select: authorizedChatSelect,
  });

  if (!chat) {
    throw new CustomError("Chat not found", 404);
  }

  return chat;
};

export const assertChatAdmin = async (
  actorUserId: string,
  chatId: string,
): Promise<AuthorizedChat> => {
  const chat = await assertChatMember(actorUserId, chatId);

  if (!chat.isGroupChat) {
    throw new CustomError("This operation is only available for group chats", 400);
  }

  if (chat.adminId !== actorUserId) {
    throw new CustomError("Group administrator permission is required", 403);
  }

  return chat;
};

export const assertMessageAccessible = async (
  actorUserId: string,
  chatId: string,
  messageId: string,
): Promise<AuthorizedMessage> => {
  if (!actorUserId) {
    throw new CustomError("Authentication is required", 401);
  }

  if (!chatId?.trim() || !messageId?.trim()) {
    throw new CustomError("ChatId and messageId are required", 400);
  }

  const message = await prisma.message.findFirst({
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
    select: authorizedMessageSelect,
  });

  if (!message) {
    throw new CustomError("Message not found", 404);
  }

  return message;
};

export const assertMessageOwner = async (
  actorUserId: string,
  chatId: string,
  messageId: string,
): Promise<AuthorizedMessage> => {
  const message = await assertMessageAccessible(actorUserId, chatId, messageId);

  if (message.senderId !== actorUserId) {
    throw new CustomError("Message owner permission is required", 403);
  }

  return message;
};

export const assertPinAccessible = async (
  actorUserId: string,
  pinId: string,
): Promise<AuthorizedPin> => {
  if (!actorUserId) {
    throw new CustomError("Authentication is required", 401);
  }

  if (!pinId?.trim()) {
    throw new CustomError("PinId is required", 400);
  }

  const pin = await prisma.pinnedMessages.findFirst({
    where: {
      id: pinId,
      chat: {
        ChatMembers: {
          some: {
            userId: actorUserId,
          },
        },
      },
    },
    select: authorizedPinSelect,
  });

  if (!pin) {
    throw new CustomError("Pinned message not found", 404);
  }

  return pin;
};

export const cacheAuthorizedChat = (request: Request, chat: AuthorizedChat): void => {
  (request as RequestWithAuthorizedChat)[authorizedChatKey] = chat;
};

export const getCachedAuthorizedChat = (
  request: Request,
  chatId: string,
): AuthorizedChat | null => {
  const chat = (request as RequestWithAuthorizedChat)[authorizedChatKey];
  return chat?.id === chatId ? chat : null;
};
