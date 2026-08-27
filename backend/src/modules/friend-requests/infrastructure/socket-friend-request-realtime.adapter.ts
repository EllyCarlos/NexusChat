import type { Server } from "socket.io";

import { Events } from "../../../enums/event/event.enum.js";
import { joinMembersInChatRoom } from "../../../utils/chat.util.js";
import { emitEvent, emitEventToRoom } from "../../../utils/socket.util.js";
import type { FriendRequestRealtimePort } from "../contracts/friend-request-realtime.port.js";

export type SocketServerResolver = () => Server;

export const createSocketFriendRequestRealtimeAdapter = (
  resolveSocketServer: SocketServerResolver,
): FriendRequestRealtimePort => {
  let resolvedSocketServer: { value: Server } | undefined;

  const getSocketServer = (): Server => {
    if (!resolvedSocketServer) {
      resolvedSocketServer = { value: resolveSocketServer() };
    }
    return resolvedSocketServer.value;
  };

  return {
    emitNewFriendRequest: (receiverId, payload) => {
      emitEvent({
        io: getSocketServer(),
        event: Events.NEW_FRIEND_REQUEST,
        data: payload,
        users: [receiverId],
      });
    },

    joinMembersInChat: (memberIds, chatId) => {
      joinMembersInChatRoom({
        io: getSocketServer(),
        memberIds: [...memberIds],
        roomToJoin: chatId,
      });
    },

    emitNewChat: (chatId, payload) => {
      emitEventToRoom({
        io: getSocketServer(),
        event: Events.NEW_CHAT,
        data: payload,
        room: chatId,
      });
    },
  };
};
