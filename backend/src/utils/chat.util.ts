import type { Server } from "socket.io";
import type { SocketConnectionDirectory } from "../socket/connection-directory.js";
import { getMemberSockets } from "./socket.util.js";

type SocketLookupDirectory = Pick<SocketConnectionDirectory, "getSockets">;

export const joinMembersInChatRoom = async ({
  directory,
  memberIds,
  roomToJoin,
  io,
}:{
  directory:SocketLookupDirectory,
  memberIds:string[],
  roomToJoin:string,
  io:Server,
}): Promise<void>=>{
    const memberSocketIds = await getMemberSockets(memberIds, directory);
    if (!memberSocketIds.length) return;
    io.in(memberSocketIds).socketsJoin(roomToJoin);
}

export const disconnectMembersFromChatRoom = async ({
  directory,
  memberIds,
  roomToLeave,
  io,
}:{
  directory:SocketLookupDirectory,
  memberIds:string[],
  roomToLeave:string,
  io:Server,
}): Promise<void>=>{
    const memberSocketIds = await getMemberSockets(memberIds, directory);
    if (!memberSocketIds.length) return;
    io.in(memberSocketIds).socketsLeave(roomToLeave);
}
