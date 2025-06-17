import { NextFunction, Response } from "express";
import { Server } from "socket.io";
import { ACCEPTED_FILE_MIME_TYPES } from "../constants/file.constant.js";
import { Events } from "../enums/event/event.enum.js";
import { AuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import { prisma } from "../lib/prisma.lib.js";
import { uploadAttachmentSchemaType } from "../schemas/message.schema.js";
import { uploadFilesToCloudinary } from "../utils/auth.util.js";
import { CustomError, asyncErrorHandler } from "../utils/error.utils.js";
import { calculateSkip } from "../utils/generic.js";
import { emitEventToRoom } from "../utils/socket.util.js";

export const uploadAttachment = asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{

    if(!req.files?.length){
        return next(new CustomError("Please provide the files",400))
    }

    const {chatId}:uploadAttachmentSchemaType = req.body

    if(!chatId){
        return next(new CustomError("ChatId is required",400))
    }

    const isExistingChat = await prisma.chat.findUnique({
        where:{
            id:chatId
        },
        include:{
            ChatMembers:{
                select:{
                  userId:true,
                }
            }
        }
    })

    if(!isExistingChat){
        return next(new CustomError("Chat not found",404))
    }

    const attachments = req.files as Express.Multer.File[]

    const invalidFiles = attachments.filter(file=>!ACCEPTED_FILE_MIME_TYPES.includes(file.mimetype))
    
    if(invalidFiles.length) {
        const invalidFileNames = invalidFiles.map(file => file.originalname).join(', ');
        return next(new CustomError(`Unsupported file types: ${invalidFileNames}, please provide valid files`, 400));
    }

    const uploadResults =  await uploadFilesToCloudinary({files:attachments})

    console.log("Cloudinary Upload Results:", uploadResults);


    if(!uploadResults){
        return next(new CustomError("Failed to upload files",500))
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

})

export const fetchAttachments = asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{

    const {id} = req.params
    const { page = 1, limit = 6 } = req.query;

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