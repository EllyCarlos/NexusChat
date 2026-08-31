import type {
  AddedMembersChatPayload,
  AddedMembersPayload,
  CreatedGroupChatPayload,
  DeletedChatPayload,
  GroupChatUpdatePayload,
  RemovedMembersPayload,
} from "./chat.types.js";

export interface ChatRealtimePort {
  joinMembers(memberIds: string[], chatId: string): Promise<void>;
  emitNewChatToRoom(chatId: string, payload: CreatedGroupChatPayload): void;
  emitNewChatToMembers(memberIds: string[], payload: AddedMembersChatPayload): Promise<void>;
  emitMembersAdded(memberIds: string[], payload: AddedMembersPayload): Promise<void>;
  disconnectMembers(memberIds: string[], chatId: string): Promise<void>;
  emitDeleteChat(memberIds: string[], payload: DeletedChatPayload): Promise<void>;
  emitMembersRemoved(memberIds: string[], payload: RemovedMembersPayload): Promise<void>;
  emitGroupChatUpdate(chatId: string, payload: GroupChatUpdatePayload): void;
}
