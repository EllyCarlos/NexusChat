import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import {
  createAddChatMembersOperation,
  createGroupChatOperation,
  createRemoveChatMembersOperation,
  createUpdateGroupChatOperation,
} from "../modules/chats/chat.service.js";
import type { AuthorizedChatMutationContext } from "../modules/chats/contracts/chat.types.js";
import { getUserChatsQuery } from "../modules/read-queries/read-query.service.js";
import type {
  addMemberToChatType,
  createChatSchemaType,
  removeMemberfromChatType,
  updateChatSchemaType,
} from "../schemas/chat.schema.js";
import {
  assertChatAdmin,
  getCachedAuthorizedChat,
} from "../services/authorization.service.js";
import { asyncErrorHandler } from "../utils/error.utils.js";
import { cleanupTemporaryFiles } from "../utils/upload-lifecycle.util.js";

const toAuthorizedChatMutationContext = (
  chat: AuthorizedChatMutationContext,
): AuthorizedChatMutationContext => ({
  id: chat.id,
  adminId: chat.adminId,
  avatarCloudinaryPublicId: chat.avatarCloudinaryPublicId,
});

const createChat = asyncErrorHandler(async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const avatar = req.file;

  try {
    const { isGroupChat, members, name }: createChatSchemaType = req.body;
    const createGroupChat = createGroupChatOperation({
      resolveSocketServer: () => req.app.get("io"),
      ...(avatar ? { avatarFile: avatar } : {}),
    });
    const payload = await createGroupChat({
      actorId: req.user.id,
      isGroupChat,
      members,
      name,
    });

    return res.status(201).json(payload);
  } finally {
    await cleanupTemporaryFiles(avatar ? [avatar] : []);
  }
});

const getUserChats = asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{
    const chatsWithUserTyping = await getUserChatsQuery(req.user.id);
    return res.status(200).json(chatsWithUserTyping)

})

const addMemberToChat = asyncErrorHandler(async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const { id } = req.params;
  const { members }: addMemberToChatType = req.body;
  const chat = await assertChatAdmin(req.user.id, id);
  const addChatMembers = createAddChatMembersOperation({
    resolveSocketServer: () => req.app.get("io"),
  });
  const payload = await addChatMembers({
    chatId: id,
    authorizedChat: toAuthorizedChatMutationContext(chat),
    memberIds: members,
  });

  return res.status(200).json(payload);
});

const removeMemberFromChat = asyncErrorHandler(async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const { id } = req.params;
  const { members }: removeMemberfromChatType = req.body;
  const chat = await assertChatAdmin(req.user.id, id);
  const removeChatMembers = createRemoveChatMembersOperation({
    resolveSocketServer: () => req.app.get("io"),
  });
  const payload = await removeChatMembers({
    chatId: id,
    authorizedChat: toAuthorizedChatMutationContext(chat),
    memberIds: members,
  });

  return res.status(200).json(payload);
});

const updateChat = asyncErrorHandler(async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const { id } = req.params;
  const { name }: updateChatSchemaType = req.body;
  const avatar = req.file;

  try {
    const updateGroupChat = createUpdateGroupChatOperation({
      resolveSocketServer: () => req.app.get("io"),
      ...(avatar ? { avatarFile: avatar } : {}),
    });
    const updatedChat = await updateGroupChat({
      chatId: id,
      name,
      authorize: async () => {
        const cachedChat = getCachedAuthorizedChat(req, id);
        const chat = cachedChat?.isGroupChat && cachedChat.adminId === req.user.id
          ? cachedChat
          : await assertChatAdmin(req.user.id, id);

        return toAuthorizedChatMutationContext(chat);
      },
    });

    return res.status(200).json(updatedChat);
  } finally {
    await cleanupTemporaryFiles(avatar ? [avatar] : []);
  }
});

export {
  addMemberToChat,
  createChat,
  getUserChats,
  removeMemberFromChat,
  updateChat,
};
