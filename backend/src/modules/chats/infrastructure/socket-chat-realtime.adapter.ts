import type { Server } from "socket.io";
import { Events } from "../../../enums/event/event.enum.js";
import {
  disconnectMembersFromChatRoom,
  joinMembersInChatRoom,
} from "../../../utils/chat.util.js";
import { emitEvent, emitEventToRoom } from "../../../utils/socket.util.js";
import type { ChatRealtimePort } from "../contracts/chat-realtime.port.js";

export type SocketServerResolver = () => Server;

export const createSocketChatRealtimeAdapter = (
  resolveSocketServer: SocketServerResolver,
): ChatRealtimePort => {
  let resolvedSocketServer: { value: Server } | undefined;

  const getSocketServer = (): Server => {
    if (!resolvedSocketServer) {
      resolvedSocketServer = { value: resolveSocketServer() };
    }
    return resolvedSocketServer.value;
  };

  return {
    joinMembers: (memberIds, chatId) => {
      joinMembersInChatRoom({
        io: getSocketServer(),
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

    emitNewChatToMembers: (memberIds, payload) => {
      emitEvent({
        io: getSocketServer(),
        event: Events.NEW_CHAT,
        users: memberIds,
        data: payload,
      });
    },

    emitMembersAdded: (memberIds, payload) => {
      emitEvent({
        io: getSocketServer(),
        event: Events.NEW_MEMBER_ADDED,
        users: memberIds,
        data: payload,
      });
    },

    disconnectMembers: (memberIds, chatId) => {
      disconnectMembersFromChatRoom({
        io: getSocketServer(),
        memberIds,
        roomToLeave: chatId,
      });
    },

    emitDeleteChat: (memberIds, payload) => {
      emitEvent({
        io: getSocketServer(),
        event: Events.DELETE_CHAT,
        users: memberIds,
        data: payload,
      });
    },

    emitMembersRemoved: (memberIds, payload) => {
      emitEvent({
        io: getSocketServer(),
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
