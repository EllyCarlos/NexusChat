import type {
  ChatAvatarUpload,
  ChatMemberPublicView,
  CreatedGroupChatView,
  GroupChatMutationView,
  UpdatedGroupChatView,
} from "./chat.types.js";

export interface CreateGroupChatPersistenceInput {
  actorId: string;
  avatar: string;
  avatarCloudinaryPublicId: string | null;
  memberIds: string[];
  name: string;
}

export interface UpdateGroupChatPersistenceInput {
  chatId: string;
  name?: string;
  avatar?: ChatAvatarUpload;
}

export interface ChatRepository {
  createGroupChatWithMembers(
    input: CreateGroupChatPersistenceInput,
  ): Promise<{ id: string }>;
  findCreatedGroupChat(
    chatId: string,
    viewerId: string,
  ): Promise<CreatedGroupChatView | null>;
  findExistingRequestedMemberUsernames(
    chatId: string,
    memberIds: string[],
  ): Promise<string[]>;
  listMemberIdsForAddition(chatId: string): Promise<string[]>;
  addMembers(chatId: string, memberIds: string[]): Promise<void>;
  findMemberPublicDetails(memberIds: string[]): Promise<ChatMemberPublicView[]>;
  findChatForAddedMemberPayload(chatId: string): Promise<GroupChatMutationView | null>;
  listMemberIdsForRemoval(chatId: string): Promise<string[]>;
  updateAdmin(chatId: string, adminId: string): Promise<void>;
  deleteMembers(chatId: string, memberIds: string[]): Promise<void>;
  updateGroupChat(input: UpdateGroupChatPersistenceInput): Promise<UpdatedGroupChatView>;
}
