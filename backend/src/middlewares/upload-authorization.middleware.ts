import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import {
  assertChatAdmin,
  assertChatMember,
  cacheAuthorizedChat,
} from "../services/authorization.service.js";
import { asyncErrorHandler } from "../utils/error.utils.js";

export const authorizeAttachmentUpload = asyncErrorHandler(async (
  request: AuthenticatedRequest,
  _response: Response,
  next: NextFunction,
) => {
  const chat = await assertChatMember(request.user.id, request.params.chatId);
  cacheAuthorizedChat(request, chat);
  next();
});

export const authorizeGroupChatUpload = asyncErrorHandler(async (
  request: AuthenticatedRequest,
  _response: Response,
  next: NextFunction,
) => {
  const chat = await assertChatAdmin(request.user.id, request.params.id);
  cacheAuthorizedChat(request, chat);
  next();
});
