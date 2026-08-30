import type {
  AcceptedPrivateChatView,
  CreatedFriendRequestView,
} from "./friend-request.types.js";

export interface FriendRequestRealtimePort {
  emitNewFriendRequest(receiverId: string, payload: CreatedFriendRequestView): Promise<void>;
  joinMembersInChat(memberIds: readonly [string, string], chatId: string): Promise<void>;
  emitNewChat(chatId: string, payload: AcceptedPrivateChatView): void;
}
