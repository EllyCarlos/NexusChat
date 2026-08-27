import type {
  AcceptedPrivateChatView,
  CreatedFriendRequestView,
} from "./friend-request.types.js";

export interface FriendRequestRealtimePort {
  emitNewFriendRequest(receiverId: string, payload: CreatedFriendRequestView): void;
  joinMembersInChat(memberIds: readonly [string, string], chatId: string): void;
  emitNewChat(chatId: string, payload: AcceptedPrivateChatView): void;
}
