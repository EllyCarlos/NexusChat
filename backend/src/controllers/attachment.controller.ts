import { NextFunction, Response } from "express";
import { Server } from "socket.io";
import { Events } from "../enums/event/event.enum.js";
import { AuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import { prisma } from "../lib/prisma.lib.js";
import { assertChatMember, getCachedAuthorizedChat } from "../services/authorization.service.js";
import { deleteFilesFromCloudinary, uploadFilesToCloudinary } from "../utils/auth.util.js";
import { CustomError, asyncErrorHandler } from "../utils/error.utils.js";
import { calculateSkip } from "../utils/generic.js";
import { emitEventToRoom } from "../utils/socket.util.js";
import { cleanupTemporaryFiles } from "../utils/upload-lifecycle.util.js";
import { logServerError } from "../utils/safe-logger.utils.js";

export const uploadAttachment = asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{
    const attachments = req.files as Express.Multer.File[]
    const chatId = req.params.chatId
    let uploadedPublicIds: string[] = []
    let attachmentsCommitted = false

    try {
      if(!attachments?.length){
          return next(new CustomError("Please provide the files",400))
      }

      if(!chatId){
          return next(new CustomError("ChatId is required",400))
      }

      const isExistingChat = getCachedAuthorizedChat(req, chatId)
        ?? await assertChatMember(req.user.id, chatId)

      const uploadResults = await uploadFilesToCloudinary({files:attachments})
      uploadedPublicIds = uploadResults.map(({public_id}) => public_id)
      if(uploadResults.length !== attachments.length){
          throw new Error("Cloudinary returned incomplete attachment results")
      }

      const attachmentsArray = uploadResults.map(({secure_url,public_id})=>({cloudinaryPublicId:public_id,secureUrl:secure_url}))

      const newMessage = await prisma.message.create({
        data:{
            chatId:chatId,
            senderId:req.user.id,
            attachments:{
              createMany:{
                data:attachmentsArray.map(attachment=>({cloudinaryPublicId:attachment.cloudinaryPublicId,secureUrl:attachment.secureUrl}))
              }
            }
        },
        include:{
          sender:{
            select:{
              id:true,
              username:true,
              avatar:true,
            }
          },
          attachments:{
            select:{
              secureUrl:true,
            }
          },
          poll:{
            omit:{
              id:true,
            }
          },
          reactions:{
            select:{
              user:{
                select:{
                  id:true,
                  username:true,
                  avatar:true
                }
              },
              reaction:true,
            }
          },
        },
        omit:{
          senderId:true,
          pollId:true,
          audioPublicId:true
        },
      })
      attachmentsCommitted = true


    const io:Server = req.app.get("io");
    emitEventToRoom({data:newMessage,event:Events.MESSAGE,io,room:chatId})
    const otherMembersOfChat = isExistingChat.ChatMembers.filter(({userId}) => req.user.id !== userId);

    const updateOrCreateUnreadMessagePromises = otherMembersOfChat.map(({ userId }) => {
        return prisma.unreadMessages.upsert({
          where: {
            userId_chatId: { userId,chatId: chatId }, // Using the unique composite key
          },
          update: {
            count: { increment: 1 },
            senderId: req.user.id,
          },
          create: {
            userId: userId,
            chatId,
            count: 1,
            senderId: req.user.id,
            messageId: newMessage.id,
          },
        });
    });
      
    await Promise.all(updateOrCreateUnreadMessagePromises);

    const unreadMessageData = 
    {
        chatId,
        message:{
            attachments:newMessage.attachments.length ? true : false,
            createdAt:newMessage.createdAt
        },
        sender:{
            id:newMessage.sender.id,
            avatar:newMessage.sender.avatar,
            username:newMessage.sender.avatar
        }
    }

    emitEventToRoom({data:unreadMessageData,event:Events.UNREAD_MESSAGE,io,room:chatId})
      return res.status(201).json({});
    } catch (error) {
      if (!attachmentsCommitted && uploadedPublicIds.length) {
        try {
          await deleteFilesFromCloudinary({ publicIds: uploadedPublicIds })
        } catch (cleanupError) {
          logServerError("New attachment rollback failed.", cleanupError)
        }
      }
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

    const attachments = await prisma.attachment.findMany({
      where:{
        message:{
          chatId:id,
        }
      },
      omit:{
        id:true,
        cloudinaryPublicId:true,
        messageId:true,
      },
      orderBy:{
        message:{
          createdAt:"desc"
        }
      },
      skip:calculateSkip(Number(page),Number(limit)),
      take:Number(limit)
    })

    const totalAttachmentsCount = await prisma.attachment.count({where:{message:{chatId:id}}})
    const totalPages =  Math.ceil(totalAttachmentsCount/Number(limit))

    const payload = {
      attachments,
      totalAttachmentsCount,
      totalPages,
    }
    
    res.status(200).json(payload);
})
