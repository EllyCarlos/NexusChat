import { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import { getChatMessagesQuery } from "../modules/read-queries/read-query.service.js";
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

