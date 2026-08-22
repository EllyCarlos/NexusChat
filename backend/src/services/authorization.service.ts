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

const authorizedCallSelect = {
  id: true,
  callerId: true,
  calleeId: true,
  startedAt: true,
  endedAt: true,
  status: true,
} satisfies Prisma.CallHistorySelect;

export type AuthorizedCall = Prisma.CallHistoryGetPayload<{
  select: typeof authorizedCallSelect;
}>;

const callableUserSelect = {
  id: true,
  notificationsEnabled: true,
  fcmToken: true,
} satisfies Prisma.UserSelect;

export type CallableUser = Prisma.UserGetPayload<{
  select: typeof callableUserSelect;
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

export const assertCanCallUser = async (
  callerId: string,
  calleeId: string,
): Promise<CallableUser> => {
  if (!callerId) {
    throw new CustomError("Authentication is required", 401);
  }

  if (!calleeId?.trim()) {
    throw new CustomError("CalleeId is required", 400);
  }

  if (callerId === calleeId) {
    throw new CustomError("Users cannot call themselves", 400);
  }

  const callee = await prisma.user.findUnique({
    where: { id: calleeId },
    select: callableUserSelect,
  });

  if (!callee) {
    throw new CustomError("User not found", 404);
  }

  const friendship = await prisma.friends.findFirst({
    where: {
      OR: [
        { user1Id: callerId, user2Id: calleeId },
        { user1Id: calleeId, user2Id: callerId },
      ],
    },
    select: { id: true },
  });

  if (!friendship) {
    throw new CustomError("Calling permission is required", 403);
  }

  return callee;
};

export const assertCallParticipant = async (
  actorUserId: string,
  callHistoryId: string,
): Promise<AuthorizedCall> => {
  if (!actorUserId) {
    throw new CustomError("Authentication is required", 401);
  }

  if (!callHistoryId?.trim()) {
    throw new CustomError("CallHistoryId is required", 400);
  }

  const call = await prisma.callHistory.findFirst({
    where: {
      id: callHistoryId,
      OR: [
        { callerId: actorUserId },
        { calleeId: actorUserId },
      ],
    },
    select: authorizedCallSelect,
  });

  if (!call) {
    throw new CustomError("Call not found", 404);
  }

  return call;
};

export const assertCallCallee = async (
  actorUserId: string,
  callHistoryId: string,
): Promise<AuthorizedCall> => {
  const call = await assertCallParticipant(actorUserId, callHistoryId);

  if (call.calleeId !== actorUserId) {
    throw new CustomError("Call callee permission is required", 403);
  }

  return call;
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
