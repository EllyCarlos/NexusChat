import type { Server } from "socket.io";
import { Events } from "../enums/event/event.enum.js";
import type { SocketConnectionDirectory } from "../socket/connection-directory.js";

type SocketLookupDirectory = Pick<SocketConnectionDirectory, "getSockets">;

export const emitEvent = async ({
    data,
    directory,
    event,
    io,
    users,
}:{
    io:Server,
    directory:SocketLookupDirectory,
    event:Events,
    users:Array<string>,
    data:unknown,
}): Promise<void>=>{
    const sockets = await getMemberSockets(users, directory);
    if(sockets.length){
        io.to(sockets).emit(event,data)
    }
}

export const emitEventToRoom = ({data,event,io,room}:{io:Server,event:Events,room:string,data:unknown})=>{
    io.to(room).emit(event,data)
}

export const getMemberSockets = async (
    members:string[],
    directory:SocketLookupDirectory,
): Promise<string[]>=>{
    const socketIds: string[] = [];
    const seenSocketIds = new Set<string>();

    for (const member of members) {
        for (const socketId of await directory.getSockets(member)) {
            if (seenSocketIds.has(socketId)) continue;
            seenSocketIds.add(socketId);
            socketIds.push(socketId);
        }
    }

    return socketIds;
}
