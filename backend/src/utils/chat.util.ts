import { Server } from "socket.io";
import { userSocketIds } from "../index.js";


// export const deleteChat = async(isExistingChat: Document<unknown, {}, IChat> & IChat & Required<{_id: Types.ObjectId}>)=>{

//         const publicIdsToBeDestroyed:Array<string> = []

//         if(isExistingChat.avatar?.publicId){
//           publicIdsToBeDestroyed.push(isExistingChat.avatar.publicId)
//         }

//         const messageWithAttachements = await Message.find({chat:isExistingChat._id,attachments:{$ne:[]}})
        
//         messageWithAttachements.forEach(message=>{

//          if(message.attachments?.length){
//            const attachmentsPublicId = message.attachments.map(attachment=>attachment.publicId)
//            publicIdsToBeDestroyed.push(...attachmentsPublicId)
//          }

//         })

//         const chatDeletePromise:Array<Promise<any>> = [
//           isExistingChat.deleteOne(),
//           Message.deleteMany({chat:isExistingChat._id}),
//           UnreadMessage.deleteMany({chat:isExistingChat._id}),
//           deleteFilesFromCloudinary({publicIds:publicIdsToBeDestroyed})
//         ]

//         await Promise.all(chatDeletePromise)
// }

export const joinMembersInChatRoom = ({memberIds,roomToJoin,io}:{memberIds:string[],roomToJoin:string,io:Server})=>{

    for(const memberId of memberIds){
      const memberSocketId = userSocketIds.get(memberId);
      if(memberSocketId){
        const memberSocket = io.sockets.sockets.get(memberSocketId);
        if(memberSocket){
          memberSocket.join(roomToJoin);
        }
      }
    }
}

export const disconnectMembersFromChatRoom = ({memberIds,roomToLeave,io}:{memberIds:string[],roomToLeave:string,io:Server})=>{

    for(const memberId of memberIds){
      const memberSocketId = userSocketIds.get(memberId);
      if(memberSocketId){
        const memberSocket = io.sockets.sockets.get(memberSocketId);
        if(memberSocket){
          memberSocket.leave(roomToLeave);
        }
      }
    }
}