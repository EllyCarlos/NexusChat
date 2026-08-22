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
