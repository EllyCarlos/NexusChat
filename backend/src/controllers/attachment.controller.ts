import { NextFunction, Response } from "express";
import { AuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import { createUploadChatAttachmentsOperation } from "../modules/attachments/attachment.service.js";
import { getChatAttachmentsQuery } from "../modules/read-queries/read-query.service.js";
import { assertChatMember, getCachedAuthorizedChat } from "../services/authorization.service.js";
import { CustomError, asyncErrorHandler } from "../utils/error.utils.js";
import { cleanupTemporaryFiles } from "../utils/upload-lifecycle.util.js";

export const uploadAttachment = asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{
    const attachments = req.files as Express.Multer.File[]
    const chatId = req.params.chatId

    try {
      if(!attachments?.length){
          return next(new CustomError("Please provide the files",400))
      }

      if(!chatId){
          return next(new CustomError("ChatId is required",400))
      }

      const authorizedChat = getCachedAuthorizedChat(req, chatId)
        ?? await assertChatMember(req.user.id, chatId)
      const uploadChatAttachments = createUploadChatAttachmentsOperation({
        files: attachments,
        resolveSocketServer: () => req.app.get("io"),
      })

      await uploadChatAttachments({
        actorId: req.user.id,
        chatId,
        memberIds: authorizedChat.ChatMembers.map(({ userId }) => userId),
        expectedUploadCount: attachments.length,
      })

      return res.status(201).json({});
    } catch (error) {
      return next(error instanceof CustomError
        ? error
        : new CustomError("Failed to upload attachments", 500))
    } finally {
      await cleanupTemporaryFiles(attachments ?? [])
    }
})

export const fetchAttachments = asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{

    const {id} = req.params
    const { page = 1, limit = 6 } = req.query;

    await assertChatMember(req.user.id, id)
    const payload = await getChatAttachmentsQuery({
      chatId: id,
      page,
      limit,
    });

    res.status(200).json(payload);
})
