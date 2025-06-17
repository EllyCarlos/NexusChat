import { UploadApiResponse } from "cloudinary";
import { NextFunction, Response } from "express";
import { Server } from "socket.io";
import { DEFAULT_AVATAR } from "../constants/file.constant.js";
import { Events } from "../enums/event/event.enum.js";
import type { AuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import { prisma } from "../lib/prisma.lib.js";
import type { addMemberToChatType, createChatSchemaType, removeMemberfromChatType, updateChatSchemaType } from "../schemas/chat.schema.js";
import { deleteFilesFromCloudinary, uploadFilesToCloudinary } from "../utils/auth.util.js";
import { disconnectMembersFromChatRoom, joinMembersInChatRoom } from "../utils/chat.util.js";
import { CustomError, asyncErrorHandler } from "../utils/error.utils.js";
import { emitEvent, emitEventToRoom } from "../utils/socket.util.js";


type GroupChatUpdateEventSendPayload = {
  chatId: string;
  chatAvatar?: string;
  chatName?: string;
}

type NewMemberAddedEventSendPayload = {
  chatId: string;
  members: {
    id: string;
    username: string;
    avatar: string;
    isOnline: boolean;
    publicKey: string | null;
    lastSeen: Date | null;
    verificationBadge: boolean;
  }[]
}

type MemberRemovedEventSendPayload = {
  chatId: string;
  membersId: string[];
}

type DeleteChatEventSendPayload = {
  chatId: string;
}

const createChat = asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{

    let uploadResults:UploadApiResponse[] | void = []

    const {isGroupChat,members,name}:createChatSchemaType = req.body

    if(isGroupChat==='true'){

        if(members.length<2){
            return next(new CustomError("Atleast 2 members are required to create group chat",400))
        }
        else if(!name){
            return next(new CustomError("name is required for creating group chat",400))
        }

        const memberIds=[...members,req.user.id]

        let hasAvatar = false;
        if(req.file){
            hasAvatar = true;
            uploadResults = await uploadFilesToCloudinary({files:[req.file]})
        }

        const avatar = (hasAvatar && uploadResults && uploadResults[0]) ? uploadResults[0].secure_url : DEFAULT_AVATAR;
        const avatarCloudinaryPublicId = (hasAvatar && uploadResults && uploadResults[0]) ? uploadResults[0].public_id : null;
        
        const newChat =  await prisma.chat.create({
          data:{
            avatar,                    
            avatarCloudinaryPublicId,
            isGroupChat:true,
            adminId:req.user.id,
            name,
          },
          select:{
            id:true,
          }
        })

        await prisma.chatMembers.createMany({
          data: memberIds.map(id=>({
            chatId:newChat.id,
            userId:id
          }))
        })

        const populatedChat = await prisma.chat.findUnique({
          where:{id:newChat.id},
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
        
        const io:Server = req.app.get("io");
        joinMembersInChatRoom({memberIds,roomToJoin:newChat.id,io})
        emitEventToRoom({event:Events.NEW_CHAT,io,room:newChat.id,data:{...populatedChat,typingUsers:[]}});
        return res.status(201);
    }
})

const getUserChats = asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{
      const chats = await prisma.chat.findMany({
          where:{
            ChatMembers:{
              some:{
                userId:req.user.id
              }
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
  
      const chatsWithUserTyping = chats.map(chat => ({
        ...chat,
        typingUsers: []
      }));
  
    return res.status(200).json(chatsWithUserTyping)

})

const addMemberToChat = asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{

    const {id}=req.params
    const {members}:addMemberToChatType = req.body

    const chat =  await prisma.chat.findUnique({where:{id}})
    
    if(!chat){
        return next(new CustomError("Chat does not exists",404))
    }
    if(!chat.isGroupChat){
        return next(new CustomError("This is not a group chat, you cannot add members",400))
    }
    const isAdminAddingMember = chat.adminId === req.user.id;
    if(!isAdminAddingMember){
        return next(new CustomError("You are not allowed to add members as you are not the admin of this chat",400))
    }

    const areMembersToBeAddedAlreadyExists = await prisma.chatMembers.findMany({
      where: {
        chatId: id,
        userId: {
          in: members,
        },
      },
      include:{
        user:{
          select:{
            username:true
          }
        }
      }
    });

    if(areMembersToBeAddedAlreadyExists.length){
      return next(new CustomError(`${areMembersToBeAddedAlreadyExists.map(({user:{username}})=>`${username}`)} already exists in members of this chat`,400))
    }

    const oldExistingMembers = await prisma.chatMembers.findMany({
      where: {
        chatId: id,
      },
      include:{
        user:{
          select:{
            id:true,
          }
        }
      }
    });

    const oldExistingMembersIds = oldExistingMembers.map(({user:{id}})=>id)

    await prisma.chatMembers.createMany({
      data: members.map(memberid=>({
        chatId:id,
        userId:memberid
      }))
    })

    const newMemberDetails = await prisma.user.findMany({
      where:{
        id:{
          in:members
        }
      },
      select:{
        id:true,
        username:true,
        avatar:true,
        isOnline:true,
        publicKey:true,
        lastSeen:true,
        verificationBadge:true
      }
    })

    const updatedChat = await prisma.chat.findUnique({
      where:{
        id:chat.id
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

    const io:Server = req.app.get("io");

    // join the new members in the chat room
    joinMembersInChatRoom({io,roomToJoin:chat.id,memberIds:members})

    // emitting the new chat event to the new members
    emitEvent({event:Events.NEW_CHAT,data:{...updatedChat,typingUsers:[],UnreadMessages:[]},io,users:members})

    // emitting the new member added event to the existing members
    // with new member details
    const payload:NewMemberAddedEventSendPayload = {
      chatId:chat.id,
      members:newMemberDetails
    }
    emitEvent({data:payload,event:Events.NEW_MEMBER_ADDED,io,users:oldExistingMembersIds});
    return res.status(200);
})

const removeMemberFromChat = asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{

    const {id}=req.params
    const {members}:removeMemberfromChatType = req.body

    const chat =  await prisma.chat.findUnique({where:{id}})
    
    if(!chat){
        return next(new CustomError("Chat does not exists",404))
    }

    if(!chat.isGroupChat){
        return next(new CustomError("This is not a group chat, you cannot remove members",400))
    }

    const isAdminRemovingMembers = req.user.id === chat.adminId;
    if(!isAdminRemovingMembers){
        return next(new CustomError("You are not allowed to remove members as you are not the admin of this chat",400))
    }

    const existingMembers =  await prisma.chatMembers.findMany({
      where:{
        chatId:id
      }
    })
    
    if(existingMembers.length===3){
      return next(new CustomError("Minimum 3 members are required in a group chat",400))
    }

    const existingMemberIds = existingMembers.map(({userId})=>userId);

    const doesMembersToBeRemovedDosentExistsAlready = members.filter(memberId=>!existingMemberIds.includes(memberId));

    if(doesMembersToBeRemovedDosentExistsAlready.length){
      return next(new CustomError("Provided members to be removed dosen't exists in chat",404))
    }

    let adminLeavingId : string | null = null;

    for(const member of members){
      if(member===chat.adminId){
        adminLeavingId = member;
        break;
      }
    }

    
    if(adminLeavingId){
        let nextAdminId:string | null = null;
        // if admin is leaving the chat
        // then assign the admin role to the next member
        for(const memberId of existingMemberIds){
          if(memberId!==adminLeavingId && !members.includes(memberId)){
            nextAdminId = memberId;
            break;
          }
        }

        if(nextAdminId){
          await prisma.chat.update({
            where:{id},
            data:{adminId:nextAdminId}
          })
        }
    }

    await prisma.chatMembers.deleteMany({
      where:{
        chatId:id,
        userId:{in:members}
      }
    })

    const io:Server = req.app.get("io");

    disconnectMembersFromChatRoom({io,memberIds:members,roomToLeave:id})

    const deletedChatPayload:DeleteChatEventSendPayload = {
      chatId:id
    }

    emitEvent({io,event:Events.DELETE_CHAT,users:members,data:deletedChatPayload})

    const remainingMembers = existingMemberIds.filter(id=>!members.includes(id))

    const payload:MemberRemovedEventSendPayload = {
      chatId:id,
      membersId:members
    }
    emitEvent({io,event:Events.MEMBER_REMOVED,data:payload,users:remainingMembers})

    return res.status(200);
})

const updateChat = asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{

    const { id } = req.params
    const { name }:updateChatSchemaType = req.body;
    const avatar = req.file

    if(!name && !avatar){
      return next(new CustomError("Either avatar or name is required for updating a chat, please provide one"))
    }

    const chat = await prisma.chat.findUnique({
      where:{id}
    })

    if (!chat) {
        return next(new CustomError("chat not found",404))
    }

    if(!chat.isGroupChat){
      return next(new CustomError("You cannot update a private chat",400))
    }

    if(avatar){
            
      if(chat.avatarCloudinaryPublicId){
        // removing old group chat avatar from cloudinary (to free up cloud space)
        await deleteFilesFromCloudinary({publicIds:[chat.avatarCloudinaryPublicId]})
      }
      // now uploading the new group chat avatar to cloudinary
      const uploadResult = await uploadFilesToCloudinary({files:[avatar]})

      if(!uploadResult){
        return next(new CustomError("Error updating chat avatar",404))    
      }

      await prisma.chat.update({
        where:{id},
        data:{
          avatarCloudinaryPublicId:uploadResult[0].public_id,
          avatar:uploadResult[0].secure_url
        }
      })
    }

    if(name){
      await prisma.chat.update({
        where:{id},
        data:{name}
      })
    }

    const updatedChat = await prisma.chat.findUnique({
      where:{id},
      select:{name:true,avatar:true,id:true}
    })

    if(!updatedChat){
      return next(new CustomError("Error updating chat",404))
    }

    
    const payload:GroupChatUpdateEventSendPayload = {
      chatId:updatedChat.id,
      chatAvatar:updatedChat.avatar,
      chatName:updatedChat.name!
    }
    
    const io:Server = req.app.get("io");
    emitEventToRoom({io,event:Events.GROUP_CHAT_UPDATE,room:id,data:payload})

    return res.status(200)
})

export { addMemberToChat, createChat, getUserChats, removeMemberFromChat, updateChat };

