import { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import { getMessageContextQuery } from "../modules/read-queries/message-context-query.service.js";
import { getChatMessagesQuery } from "../modules/read-queries/read-query.service.js";
import type {
  MessageContextParams,
  MessageContextQuery,
} from "../schemas/message.schema.js";
import { assertChatMember } from "../services/authorization.service.js";
import { asyncErrorHandler } from "../utils/error.utils.js";

export const getMessages = asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{

    const {id} = req.params
    const {page = 1, limit = 20} = req.query

    await assertChatMember(req.user.id, id)
    const messagesWithTotalPage = await getChatMessagesQuery({
      chatId: id,
      page,
      limit,
    });
    return res.status(200).json(messagesWithTotalPage)

})

export const getMessageContext = asyncErrorHandler(async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const { chatId, messageId } = req.params as MessageContextParams;
  const { before, after } = req.query as unknown as MessageContextQuery;
  const context = await getMessageContextQuery({
    actorUserId: req.user.id,
    chatId,
    messageId,
    before,
    after,
  });

  return res.status(200).json(context);
});

