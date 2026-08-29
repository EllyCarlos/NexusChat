import type {
  DeleteReactionRealtimePayload,
  NewReactionRealtimePayload,
  PinLimitReachedRealtimePayload,
  PinMessageRealtimePayload,
  UnpinMessageRealtimePayload,
  UserTypingRealtimePayload,
  VoteInRealtimePayload,
  VoteOutRealtimePayload,
} from "./chat-realtime.types.js";

export interface ChatInteractionRealtimePort {
  emitNewReaction(chatId: string, payload: NewReactionRealtimePayload): void;
  emitDeleteReaction(chatId: string, payload: DeleteReactionRealtimePayload): void;
  broadcastTypingToOthers(chatId: string, payload: UserTypingRealtimePayload): void;
  emitVoteIn(chatId: string, payload: VoteInRealtimePayload): void;
  emitVoteOut(chatId: string, payload: VoteOutRealtimePayload): void;
  emitPinLimitReached(chatId: string, payload: PinLimitReachedRealtimePayload): void;
  emitPinMessage(chatId: string, payload: PinMessageRealtimePayload): void;
  emitUnpinMessage(chatId: string, payload: UnpinMessageRealtimePayload): void;
}
