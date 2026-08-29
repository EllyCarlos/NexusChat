import type { Server } from "socket.io";
import { socketConnectionRegistry } from "../socket/connection-registry.js";

export const joinMembersInChatRoom = ({memberIds,roomToJoin,io}:{memberIds:string[],roomToJoin:string,io:Server})=>{

    for(const memberId of memberIds){
      for (const memberSocketId of socketConnectionRegistry.getSockets(memberId)) {
        const memberSocket = io.sockets.sockets.get(memberSocketId);
        if(memberSocket){
          memberSocket.join(roomToJoin);
        }
      }
    }
}

export const disconnectMembersFromChatRoom = ({memberIds,roomToLeave,io}:{memberIds:string[],roomToLeave:string,io:Server})=>{

    for(const memberId of memberIds){
      for (const memberSocketId of socketConnectionRegistry.getSockets(memberId)) {
        const memberSocket = io.sockets.sockets.get(memberSocketId);
        if(memberSocket){
          memberSocket.leave(roomToLeave);
        }
      }
    }
}
