export interface BasicChatUserView {
  id: string;
  username: string;
  avatar: string;
}

export interface ChatMemberPublicView extends BasicChatUserView {
  isOnline: boolean;
  publicKey: string | null;
  lastSeen: Date | null;
  verificationBadge: boolean;
}

export interface ChatSecureAttachmentView {
  secureUrl: string;
}

export interface ChatUnreadMessageView {
  count: number;
  message: {
    isTextMessage: boolean;
    url: string | null;
    attachments: ChatSecureAttachmentView[];
    isPollMessage: boolean;
    createdAt: Date;
    textMessageContent: string | null;
  };
  sender: ChatMemberPublicView;
}

export interface ChatLatestMessageView {
  id: string;
  isTextMessage: boolean;
  textMessageContent: string | null;
  senderId: string;
  chatId: string;
  url: string | null;
  pollId: string | null;
  isPollMessage: boolean;
  audioUrl: string | null;
  audioPublicId: string | null;
  isEdited: boolean;
  replyToMessageId: string | null;
  isPinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  sender: BasicChatUserView;
  attachments: ChatSecureAttachmentView[];
  poll: {
    id: string;
    question: string;
    options: string[];
    multipleAnswers: boolean;
  } | null;
  reactions: Array<{
    reaction: string;
    user: BasicChatUserView;
  }>;
}

export interface GroupChatMutationView {
  id: string;
  name: string | null;
  isGroupChat: boolean;
  avatar: string;
  adminId: string | null;
  latestMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
  ChatMembers: Array<{
    user: ChatMemberPublicView;
  }>;
  latestMessage: ChatLatestMessageView | null;
}

export interface CreatedGroupChatView extends GroupChatMutationView {
  UnreadMessages: ChatUnreadMessageView[];
}

export interface CreatedGroupChatPayload extends CreatedGroupChatView {
  typingUsers: string[];
}

export interface AddedMembersChatPayload extends GroupChatMutationView {
  typingUsers: string[];
  UnreadMessages: [];
}

export interface AddedMembersPayload {
  chatId: string;
  members: ChatMemberPublicView[];
}

export interface RemovedMembersPayload {
  chatId: string;
  membersId: string[];
}

export interface DeletedChatPayload {
  chatId: string;
}

export interface UpdatedGroupChatView {
  id: string;
  name: string | null;
  avatar: string;
}

export interface GroupChatUpdatePayload {
  chatId: string;
  chatAvatar: string;
  chatName: string | null;
}

export interface ChatAvatarUpload {
  publicId: string;
  secureUrl: string;
}

export interface AuthorizedChatMutationContext {
  id: string;
  adminId: string | null;
  avatarCloudinaryPublicId: string | null;
}
