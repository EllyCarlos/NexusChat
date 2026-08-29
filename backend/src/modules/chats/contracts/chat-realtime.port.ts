import type {
  AddedMembersChatPayload,
  AddedMembersPayload,
  CreatedGroupChatPayload,
  DeletedChatPayload,
  GroupChatUpdatePayload,
  RemovedMembersPayload,
} from "./chat.types.js";

export interface ChatRealtimePort {
  joinMembers(memberIds: string[], chatId: string): void;
  emitNewChatToRoom(chatId: string, payload: CreatedGroupChatPayload): void;
  emitNewChatToMembers(memberIds: string[], payload: AddedMembersChatPayload): void;
  emitMembersAdded(memberIds: string[], payload: AddedMembersPayload): void;
  disconnectMembers(memberIds: string[], chatId: string): void;
  emitDeleteChat(memberIds: string[], payload: DeletedChatPayload): void;
  emitMembersRemoved(memberIds: string[], payload: RemovedMembersPayload): void;
  emitGroupChatUpdate(chatId: string, payload: GroupChatUpdatePayload): void;
}
