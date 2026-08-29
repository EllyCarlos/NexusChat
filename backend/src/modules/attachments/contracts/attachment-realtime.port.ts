import type {
  AttachmentMessageView,
  AttachmentUnreadMessagePayload,
} from "./attachment.types.js";

export interface AttachmentRealtimePort {
  emitMessage(chatId: string, message: AttachmentMessageView): void;
  emitUnreadMessage(
    chatId: string,
    payload: AttachmentUnreadMessagePayload,
  ): void;
}
