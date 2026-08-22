import { Server } from "socket.io";
import { Events } from "../enums/event/event.enum.js";
import { socketConnectionRegistry } from "../socket/connection-registry.js";

export const emitEvent = ({data,event,io,users}:{io:Server,event:Events,users:Array<string>,data:unknown})=>{
    const sockets = getMemberSockets(users);
    if(sockets.length){
        io.to(sockets).emit(event,data)
    }
}

export const emitEventToRoom = ({data,event,io,room}:{io:Server,event:Events,room:string,data:unknown})=>{
    io.to(room).emit(event,data)
}

export const getOtherMembers=({members,user}:{members:Array<string>,user:string})=>{
    return members.filter(member=>member!==user)
}

export const getMemberSockets = (members:string[])=>{
    return [...new Set(members.flatMap(member=>socketConnectionRegistry.getSockets(member)))]
}
