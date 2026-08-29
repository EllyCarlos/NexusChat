import type { Server, Socket } from "socket.io";
import { Events } from "../../../enums/event/event.enum.js";
import type { ChatInteractionRealtimePort } from "../contracts/interaction-realtime.port.js";
import type { MessageRealtimePort } from "../contracts/message-realtime.port.js";

type SocketChatEventRealtimeAdapterInput = {
  io: Server;
  socket: Socket;
};

export type SocketChatEventRealtimeAdapter = MessageRealtimePort & ChatInteractionRealtimePort;

export const createSocketChatEventRealtimeAdapter = ({
  io,
  socket,
}: SocketChatEventRealtimeAdapterInput): SocketChatEventRealtimeAdapter => ({
  emitMessage: (chatId, payload) => {
    io.to(chatId).emit(Events.MESSAGE, payload);
  },

  emitUnreadMessage: (chatId, payload) => {
    io.to(chatId).emit(Events.UNREAD_MESSAGE, payload);
  },

  emitMessageSeen: (chatId, payload) => {
    io.to(chatId).emit(Events.MESSAGE_SEEN, payload);
  },

  emitMessageEdit: (chatId, payload) => {
    io.to(chatId).emit(Events.MESSAGE_EDIT, payload);
  },

  emitMessageDelete: (chatId, payload) => {
    io.to(chatId).emit(Events.MESSAGE_DELETE, payload);
  },

  emitNewReaction: (chatId, payload) => {
    io.to(chatId).emit(Events.NEW_REACTION, payload);
  },

  emitDeleteReaction: (chatId, payload) => {
    io.to(chatId).emit(Events.DELETE_REACTION, payload);
  },

  broadcastTypingToOthers: (chatId, payload) => {
    socket.broadcast.to(chatId).emit(Events.USER_TYPING, payload);
  },

  emitVoteIn: (chatId, payload) => {
    io.to(chatId).emit(Events.VOTE_IN, payload);
  },

  emitVoteOut: (chatId, payload) => {
    io.to(chatId).emit(Events.VOTE_OUT, payload);
  },

  emitPinLimitReached: (chatId, payload) => {
    io.to(chatId).emit(Events.PIN_LIMIT_REACHED, payload);
  },

  emitPinMessage: (chatId, payload) => {
    io.to(chatId).emit(Events.PIN_MESSAGE, payload);
  },

  emitUnpinMessage: (chatId, payload) => {
    io.to(chatId).emit(Events.UNPIN_MESSAGE, payload);
  },
});
