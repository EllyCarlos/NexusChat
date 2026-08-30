import type { Server } from "socket.io";
import { Events } from "../../../enums/event/event.enum.js";
import type { SocketConnectionDirectory } from "../../../socket/connection-directory.js";
import {
  disconnectMembersFromChatRoom,
  joinMembersInChatRoom,
} from "../../../utils/chat.util.js";
import { emitEvent, emitEventToRoom } from "../../../utils/socket.util.js";
import type { ChatRealtimePort } from "../contracts/chat-realtime.port.js";

export type SocketServerResolver = () => Server;
export type SocketConnectionDirectoryResolver = () => SocketConnectionDirectory;

export const createSocketChatRealtimeAdapter = (
  resolveSocketServer: SocketServerResolver,
  resolveConnectionDirectory: SocketConnectionDirectoryResolver,
): ChatRealtimePort => {
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
    joinMembers: async (memberIds, chatId) => {
      await joinMembersInChatRoom({
        io: getSocketServer(),
        directory: getConnectionDirectory(),
        memberIds,
        roomToJoin: chatId,
      });
    },

    emitNewChatToRoom: (chatId, payload) => {
      emitEventToRoom({
        io: getSocketServer(),
        event: Events.NEW_CHAT,
        room: chatId,
        data: payload,
      });
    },

    emitNewChatToMembers: async (memberIds, payload) => {
      await emitEvent({
        io: getSocketServer(),
        directory: getConnectionDirectory(),
        event: Events.NEW_CHAT,
        users: memberIds,
        data: payload,
      });
    },

    emitMembersAdded: async (memberIds, payload) => {
      await emitEvent({
        io: getSocketServer(),
        directory: getConnectionDirectory(),
        event: Events.NEW_MEMBER_ADDED,
        users: memberIds,
        data: payload,
      });
    },

    disconnectMembers: async (memberIds, chatId) => {
      await disconnectMembersFromChatRoom({
        io: getSocketServer(),
        directory: getConnectionDirectory(),
        memberIds,
        roomToLeave: chatId,
      });
    },

    emitDeleteChat: async (memberIds, payload) => {
      await emitEvent({
        io: getSocketServer(),
        directory: getConnectionDirectory(),
        event: Events.DELETE_CHAT,
        users: memberIds,
        data: payload,
      });
    },

    emitMembersRemoved: async (memberIds, payload) => {
      await emitEvent({
        io: getSocketServer(),
        directory: getConnectionDirectory(),
        event: Events.MEMBER_REMOVED,
        users: memberIds,
        data: payload,
      });
    },

    emitGroupChatUpdate: (chatId, payload) => {
      emitEventToRoom({
        io: getSocketServer(),
        event: Events.GROUP_CHAT_UPDATE,
        room: chatId,
        data: payload,
      });
    },
  };
};
