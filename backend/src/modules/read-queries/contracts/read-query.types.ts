export interface BasicReadUser {
  id: string;
  username: string;
  avatar: string;
}

export interface ChatReadParticipant extends BasicReadUser {
  isOnline: boolean;
  publicKey: string | null;
  lastSeen: Date | null;
  verificationBadge: boolean;
}

export interface SecureAttachmentView {
  secureUrl: string;
}

export interface ChatUnreadMessageView {
  count: number;
  message: {
    isTextMessage: boolean;
    url: string | null;
    attachments: SecureAttachmentView[];
    isPollMessage: boolean;
    createdAt: Date;
    textMessageContent: string | null;
  };
  sender: ChatReadParticipant;
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
  sender: BasicReadUser;
  attachments: SecureAttachmentView[];
  poll: {
    id: string;
    question: string;
    options: string[];
    multipleAnswers: boolean;
  } | null;
  reactions: Array<{
    reaction: string;
    user: BasicReadUser;
  }>;
}

export interface ChatReadRecord {
  id: string;
  name: string | null;
  isGroupChat: boolean;
  avatar: string;
  adminId: string | null;
  latestMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
  ChatMembers: Array<{
    user: ChatReadParticipant;
  }>;
  UnreadMessages: ChatUnreadMessageView[];
  latestMessage: ChatLatestMessageView | null;
}

export interface UserChatView extends ChatReadRecord {
  typingUsers: string[];
}

export interface MessageReadView {
  id: string;
  isTextMessage: boolean;
  textMessageContent: string | null;
  chatId: string;
  url: string | null;
  isPollMessage: boolean;
  audioUrl: string | null;
  audioPublicId: string | null;
  isEdited: boolean;
  replyToMessageId: string | null;
  isPinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  sender: BasicReadUser;
  attachments: SecureAttachmentView[];
  poll: {
    question: string;
    options: string[];
    multipleAnswers: boolean;
    votes: Array<{
      optionIndex: number;
      user: BasicReadUser;
    }>;
  } | null;
  reactions: Array<{
    reaction: string;
    user: BasicReadUser;
  }>;
  replyToMessage: {
    id: string;
    textMessageContent: string | null;
    isPollMessage: boolean;
    url: string | null;
    audioUrl: string | null;
    sender: BasicReadUser;
    attachments: SecureAttachmentView[];
  } | null;
}

export interface MessagePageView {
  messages: MessageReadView[];
  totalPages: number;
}

export interface MessageContextView {
  anchorMessageId: string;
  messages: MessageReadView[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}

export interface MessageSearchResultView {
  id: string;
  chatId: string;
  textMessageContent: string;
  isEdited: boolean;
  createdAt: Date;
  sender: BasicReadUser;
}

export interface MessageSearchRecord extends Omit<MessageSearchResultView, "textMessageContent"> {
  textMessageContent: string | null;
}

export interface MessageSearchView {
  messages: MessageSearchResultView[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface MessageSearchCursor {
  createdAt: Date;
  id: string;
}

export interface AttachmentPageView {
  attachments: SecureAttachmentView[];
  totalAttachmentsCount: number;
  totalPages: number;
}

export interface ReadPageInput {
  chatId: string;
  page?: unknown;
  limit?: unknown;
}

export interface ReadRepositoryPageInput {
  chatId: string;
  skip: number;
  take: number;
}

export interface ReadMessageContextInput {
  actorUserId: string;
  chatId: string;
  messageId: string;
  before: number;
  after: number;
}

export interface ReadMessageByIdInput {
  actorUserId: string;
  chatId: string;
  messageId: string;
}

export interface ReadMessageContextSideInput extends ReadMessageByIdInput {
  anchorCreatedAt: Date;
  take: number;
}

export interface ReadGroupMessageSearchInput {
  actorUserId: string;
  chatId: string;
  q: string;
  limit: number;
  cursor?: string;
}

export interface ReadGroupMessageSearchRepositoryInput {
  actorUserId: string;
  chatId: string;
  escapedQuery: string;
  cursor?: MessageSearchCursor;
  take: number;
}
