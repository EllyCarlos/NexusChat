import multer from 'multer'
import { MAX_FILE_SIZE } from '../constants/file.constant.js'
import type { AuthenticatedRequest } from '../interfaces/auth/auth.interface.js'
import { assertChatAdmin, assertChatMember, cacheAuthorizedChat, getCachedAuthorizedChat } from '../services/authorization.service.js'
import { CustomError } from '../utils/error.utils.js'
import {v4 as uuidV4 } from 'uuid'

const limits = {fileSize:MAX_FILE_SIZE}

const storage = multer.diskStorage({
    filename:(req:AuthenticatedRequest,file,cb)=>{
        const userId=req.user.id
        const uniqueMiddleName = uuidV4()
        const newFileName = `${userId}-${uniqueMiddleName}-${file.originalname}`
        cb(null,newFileName)
    }
})

export const authorizeAttachmentFile: NonNullable<multer.Options['fileFilter']> = (req,file,cb) => {
    const authenticatedRequest = req as AuthenticatedRequest
    const chatId = req.body?.chatId

    if(typeof chatId !== 'string' || !chatId.trim()){
        cb(new CustomError('ChatId must be provided before attachments',400))
        return
    }

    const cachedChat = getCachedAuthorizedChat(req,chatId)
    if(cachedChat){
        cb(null,true)
        return
    }

    void assertChatMember(authenticatedRequest.user?.id,chatId)
        .then(chat=>{
            cacheAuthorizedChat(req,chat)
            cb(null,true)
        })
        .catch(error=>{
            cb(error instanceof Error ? error : new CustomError('Unable to authorize attachment upload',500))
        })
}

export const authorizeGroupChatFile: NonNullable<multer.Options['fileFilter']> = (req,file,cb) => {
    const authenticatedRequest = req as AuthenticatedRequest
    const chatId = req.params.id
    const cachedChat = getCachedAuthorizedChat(req,chatId)

    if(cachedChat?.isGroupChat && cachedChat.adminId === authenticatedRequest.user?.id){
        cb(null,true)
        return
    }

    void assertChatAdmin(authenticatedRequest.user?.id,chatId)
        .then(chat=>{
            cacheAuthorizedChat(req,chat)
            cb(null,true)
        })
        .catch(error=>{
            cb(error instanceof Error ? error : new CustomError('Unable to authorize group avatar upload',500))
        })
}

export const upload = multer({limits,storage})

export const attachmentUpload = multer({
    limits,
    storage,
    fileFilter:authorizeAttachmentFile,
})

export const groupChatUpload = multer({
    limits,
    storage,
    fileFilter:authorizeGroupChatFile,
})

