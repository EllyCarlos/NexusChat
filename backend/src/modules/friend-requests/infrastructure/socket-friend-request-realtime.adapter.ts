import type { Server } from "socket.io";

import { Events } from "../../../enums/event/event.enum.js";
import type { SocketConnectionDirectory } from "../../../socket/connection-directory.js";
import { joinMembersInChatRoom } from "../../../utils/chat.util.js";
import { emitEvent, emitEventToRoom } from "../../../utils/socket.util.js";
import type { FriendRequestRealtimePort } from "../contracts/friend-request-realtime.port.js";

export type SocketServerResolver = () => Server;
export type SocketConnectionDirectoryResolver = () => SocketConnectionDirectory;

export const createSocketFriendRequestRealtimeAdapter = (
  resolveSocketServer: SocketServerResolver,
  resolveConnectionDirectory: SocketConnectionDirectoryResolver,
): FriendRequestRealtimePort => {
  let resolvedSocketServer: { value: Server } | undefined;
  let resolvedConnectionDirectory: { value: SocketConnectionDirectory } | undefined;

  const getSocketServer = (): Server => {
    if (!resolvedSocketServer) {
      resolvedSocketServer = { value: resolveSocketServer() };
    }
    return resolvedSocketServer.value;
  };

  const getConnectionDirectory = (): SocketConnectionDirectory => {
    if (!resolvedConnectionDirectory) {
      resolvedConnectionDirectory = { value: resolveConnectionDirectory() };
    }
    return resolvedConnectionDirectory.value;
  };

  return {
    emitNewFriendRequest: async (receiverId, payload) => {
      await emitEvent({
        io: getSocketServer(),
        directory: getConnectionDirectory(),
        event: Events.NEW_FRIEND_REQUEST,
        data: payload,
        users: [receiverId],
      });
    },

    joinMembersInChat: async (memberIds, chatId) => {
      await joinMembersInChatRoom({
        io: getSocketServer(),
        directory: getConnectionDirectory(),
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
