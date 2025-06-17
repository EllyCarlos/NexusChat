import { NextFunction, Response } from "express";
import { Server } from "socket.io";
import { Events } from "../enums/event/event.enum.js";
import type { AuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import { prisma } from "../lib/prisma.lib.js";
import type { createRequestSchemaType, handleRequestSchemaType } from "../schemas/request.schema.js";
import { joinMembersInChatRoom } from "../utils/chat.util.js";
import { CustomError, asyncErrorHandler } from "../utils/error.utils.js";
import { sendPushNotification } from "../utils/generic.js";
import { emitEvent, emitEventToRoom } from "../utils/socket.util.js";


export const getUserRequests = asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{

    const friendRequests = await prisma.friendRequest.findMany({
      where:{
        receiverId:req.user.id
      },
      include:{
        sender:{
          select:{
            id:true,
            username:true,
            avatar:true,
            isOnline:true,
            publicKey:true,
            lastSeen:true,
            verificationBadge:true
          }
        }
      },
      omit:{
        receiverId:true,
        updatedAt:true,
      }
    })
    
    return res.status(200).json(friendRequests)
})

export const createRequest = asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{

    const {receiver}:createRequestSchemaType = req.body

    const isValidReceiverId = await prisma.user.findUnique({where:{id:receiver}})

    if(!isValidReceiverId){
        return next(new CustomError("Receiver not found",404))
    }

    if(req.user.id === receiver){
        return next(new CustomError("You cannot send a request to yourself",400))
    }

    const requestAlreadyExists = await prisma.friendRequest.findFirst({
      where:{
        AND:[
          {
            receiverId:receiver,
          },
          {
            senderId:req.user.id
          }
        ]
      }
    })

    if(requestAlreadyExists){
        return next(new CustomError("Request is already sent, please wait for them to either accept or reject it",400))
    }


    const doesRequestExistsFromReceiver = await prisma.friendRequest.findFirst({
      where:{
        AND:[
          {
            senderId:receiver,
          },
          {
            receiverId:req.user.id
          }
        ]
      } 
    })

    if(doesRequestExistsFromReceiver){
      return next(new CustomError("They have already sent you a friend request",400))
    }

    const areAlreadyFriends = await prisma.friends.findFirst({
      where:{
        OR:[
          {
            user1Id:req.user.id,
            user2Id:receiver
          },
          {
            user1Id:receiver,
            user2Id:req.user.id
          }
        ]
      }
    })

    if(areAlreadyFriends){
      return next(new CustomError("You are already friends",400));
    }

    // const newRequest = await Request.create({receiver,sender:req.user?._id})
    const newRequest = await prisma.friendRequest.create({
      data:{
        senderId:req.user.id,
        receiverId:receiver
      },
      include:{
        sender:{
          select:{
            id:true,
            username:true,
            avatar:true,
            isOnline:true,
            publicKey:true,
            lastSeen:true,
            verificationBadge:true
          }
        }
      },
      omit:{
        receiverId:true,
        updatedAt:true,
        senderId:true,
      }
    })

    if(isValidReceiverId.fcmToken && isValidReceiverId.notificationsEnabled){
      console.log('push notification triggered for receiver');
      sendPushNotification({fcmToken:isValidReceiverId.fcmToken,body:`${req.user.username} sent you a friend request 😃`})
    }

    const io:Server = req.app.get('io');
    emitEvent({io,event:Events.NEW_FRIEND_REQUEST,data:newRequest,users:[receiver]})

    return res.status(201).json({})
})

export const handleRequest = asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{

    const {id}=req.params
    const {action}:handleRequestSchemaType = req.body

    const isExistingRequest = await prisma.friendRequest.findFirst({
      where:{
        id,
      }
    })

    if(!isExistingRequest){
        return next(new CustomError("Request not found",404))
    }

    if(isExistingRequest.receiverId !== req.user.id){
        return next(new CustomError("Only the receiver of this request can accept or reject it",401))
    }

    if(action==='accept'){

      const existingChat = await prisma.chat.findFirst({
        where: {
            isGroupChat: false,  // Ensure it's a private chat
            ChatMembers: {
                every: {  // Ensure both users are part of the chat
                    userId: { in: [isExistingRequest.senderId, isExistingRequest.receiverId] }
                }
            }
        }
     });

     if(existingChat){
        return next(new CustomError("Your private chat already exists",400));
     }

        const newChat = await prisma.chat.create({
          data:{
            ChatMembers:{
              create:[
                {user:{connect:{id:isExistingRequest.senderId}}},
                {user:{connect:{id:isExistingRequest.receiverId}}}
              ]
            }
          },
          omit:{
            avatarCloudinaryPublicId:true,
          },
          include:{
            ChatMembers:{
              include:{
                user:{
                  select:{
                    id:true,
                    username:true,
                    avatar:true,
                    isOnline:true,
                    publicKey: true,
                    lastSeen:true,
                    verificationBadge:true,
                  }
                },
              },
              omit:{
                chatId:true,
                userId:true,
                id:true,
              }
            },
            UnreadMessages:{
              where:{
                userId:req.user.id
              },
              select:{
                count:true,
                message:{
                  select:{
                    isTextMessage:true,
                    url:true,
                    attachments:{
                      select:{
                        secureUrl:true,
                      }
                    },
                    isPollMessage:true,
                    createdAt:true,
                    textMessageContent:true,
                  }
                },
                sender:{
                  select:{
                    id:true,
                    username:true,
                    avatar:true,
                    isOnline:true,
                    publicKey:true,
                    lastSeen:true,
                    verificationBadge:true
                  }
                },
              }
            },
            latestMessage:{
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
                    secureUrl:true
                  }
                },
                poll:true,
                reactions:{
                  include:{
                    user:{
                      select:{
                        id:true,
                        username:true,
                        avatar:true
                      }
                    },
                  },
                  omit:{
                    id: true,
                    createdAt: true,
                    updatedAt: true,
                    userId: true,
                    messageId: true
                  }
                },
              }
            }
          },
        })
       
        const newFriendEntry =  await prisma.friends.create({
          data:{
            user1:{
              connect:{
                id:isExistingRequest.senderId
              }
            },
            user2:{
              connect:{
                id:isExistingRequest.receiverId
              }
            }
          },
          include:{
            user1:true,
            user2:true,
          }
        })

        let sender = newFriendEntry.user1

        if(sender.id!=isExistingRequest.senderId){
          sender = newFriendEntry.user2
        }

        if(sender.notificationsEnabled && sender.fcmToken){
          sendPushNotification({fcmToken:sender.fcmToken,body:`${req.user.username} has accepted your friend request 😃`})
        }

        const io:Server = req.app.get('io');
        joinMembersInChatRoom({io,memberIds:[isExistingRequest.senderId,isExistingRequest.receiverId],roomToJoin:newChat.id});
        
        await prisma.friendRequest.delete({
          where:{
            id,
          }
        })
        
        emitEventToRoom({data:{...newChat,typingUsers:[]},event:Events.NEW_CHAT,io,room:newChat.id})
        return res.status(200).json({id:isExistingRequest.id})
    }

    else if(action==='reject'){

        const deletedRequest = await prisma.friendRequest.delete({
          where:{
            id,
          },
          include:{
            sender:{
              select:{
                isOnline:true,
                fcmToken:true,
                notificationsEnabled:true,
              }
            }
          }
        })

        const sender = deletedRequest.sender

        if(sender.fcmToken && sender.notificationsEnabled){
          sendPushNotification({fcmToken:sender.fcmToken,body:`${req.user.username} has rejected your friend request ☹️`})
        }
        return res.status(200).json({id:deletedRequest.id})
    }
    
})

