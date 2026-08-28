export interface AttachmentUpload {
  publicId: string;
  secureUrl: string;
}

export interface AttachmentMessageUserView {
  id: string;
  username: string;
  avatar: string;
}

export interface AttachmentMessageView {
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
  sender: AttachmentMessageUserView;
  attachments: Array<{
    secureUrl: string;
  }>;
  poll: {
    question: string;
    options: string[];
    multipleAnswers: boolean;
  } | null;
  reactions: Array<{
    user: AttachmentMessageUserView;
    reaction: string;
  }>;
}

export interface AttachmentUnreadMessagePayload {
  chatId: string;
  message: {
    attachments: boolean;
    createdAt: Date;
  };
  sender: AttachmentMessageUserView;
}
