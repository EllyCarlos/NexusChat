export interface ChatRealtimeUser {
  id: string;
  username: string;
  avatar: string;
}

export interface ChatRealtimeAttachment {
  secureUrl: string;
}

export interface ChatRealtimePollVote {
  optionIndex: number;
  user: ChatRealtimeUser;
}

export interface ChatRealtimePoll {
  question: string;
  options: string[];
  multipleAnswers: boolean;
  votes: ChatRealtimePollVote[];
}

export interface ChatRealtimeReaction {
  user: ChatRealtimeUser;
  reaction: string;
}

export interface ChatRealtimeReplyMessage {
  id: string;
  textMessageContent: string | null;
  isPollMessage: boolean;
  url: string | null;
  audioUrl: string | null;
  sender: ChatRealtimeUser;
  attachments: ChatRealtimeAttachment[];
}

export interface ChatRealtimeMessageView {
  id: string;
  isTextMessage: boolean;
  textMessageContent: string | null;
  chatId: string;
  url: string | null;
  isPollMessage: boolean;
  audioUrl: string | null;
  isEdited: boolean;
  replyToMessageId: string | null;
  isPinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  sender: ChatRealtimeUser;
  attachments: ChatRealtimeAttachment[];
  poll: ChatRealtimePoll | null;
  reactions: ChatRealtimeReaction[];
  replyToMessage: ChatRealtimeReplyMessage | null;
}

export interface MessageRealtimePayload extends ChatRealtimeMessageView {
  isNew: true;
}

export interface UnreadMessageRealtimePayload {
  chatId: string;
  message?: {
    textMessageContent?: string | null;
    url?: boolean | null;
    attachments?: boolean;
    poll?: boolean;
    createdAt: Date;
    audio?: boolean;
  };
  sender: ChatRealtimeUser;
}

export interface MessageSeenRealtimePayload {
  user: ChatRealtimeUser;
  chatId: string;
  readAt: Date;
}

export interface MessageEditRealtimePayload {
  chatId: string;
  messageId: string;
  updatedTextMessageContent: string;
}

export interface MessageDeleteRealtimePayload {
  chatId: string;
  messageId: string;
}

export interface NewReactionRealtimePayload {
  chatId: string;
  messageId: string;
  user: ChatRealtimeUser;
  reaction: string;
}

export interface DeleteReactionRealtimePayload {
  chatId: string;
  messageId: string;
  userId: string;
}

export interface UserTypingRealtimePayload {
  user: ChatRealtimeUser;
  chatId: string;
}

export interface VoteInRealtimePayload {
  messageId: string;
  user: ChatRealtimeUser;
  optionIndex: number;
  chatId: string;
}

export interface VoteOutRealtimePayload {
  chatId: string;
  messageId: string;
  userId: string;
  optionIndex: number;
}

export interface PinLimitReachedRealtimePayload {
  oldestPinId: string;
  messageId: string;
  chatId: string;
}

export interface PinnedChatRealtimeMessageView extends ChatRealtimeMessageView {
  audioPublicId: string | null;
}

export interface PinMessageRealtimePayload {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  message: PinnedChatRealtimeMessageView;
}

export interface UnpinMessageRealtimePayload {
  pinId: string;
  chatId: string;
  messageId: string;
}
