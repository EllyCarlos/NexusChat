import type {
  MessageDeleteRealtimePayload,
  MessageEditRealtimePayload,
  MessageRealtimePayload,
  MessageSeenRealtimePayload,
  UnreadMessageRealtimePayload,
} from "./chat-realtime.types.js";

export interface MessageRealtimePort {
  emitMessage(chatId: string, payload: MessageRealtimePayload): void;
  emitUnreadMessage(chatId: string, payload: UnreadMessageRealtimePayload): void;
  emitMessageSeen(chatId: string, payload: MessageSeenRealtimePayload): void;
  emitMessageEdit(chatId: string, payload: MessageEditRealtimePayload): void;
  emitMessageDelete(chatId: string, payload: MessageDeleteRealtimePayload): void;
}
