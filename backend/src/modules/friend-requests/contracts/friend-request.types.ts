export type FriendRequestAction = "accept" | "reject";

export interface FriendRequestActor {
  id: string;
  username: string;
}

export interface NotificationTarget {
  fcmToken: string | null;
  notificationsEnabled: boolean;
}

export interface RequestReceiver extends NotificationTarget {
  id: string;
}

export interface FriendRequestParticipant {
  id: string;
  username: string;
  avatar: string;
  isOnline: boolean;
  publicKey: string | null;
  lastSeen: Date | null;
  verificationBadge: boolean;
}

export interface IncomingFriendRequestView {
  id: string;
  senderId: string;
  status: string;
  createdAt: Date;
  sender: FriendRequestParticipant;
}

export interface CreatedFriendRequestView {
  id: string;
  status: string;
  createdAt: Date;
  sender: FriendRequestParticipant;
}

export interface PendingFriendRequest {
  id: string;
  senderId: string;
  receiverId: string;
}

export interface FriendshipParticipant extends NotificationTarget {
  id: string;
}

export interface FriendshipParticipants {
  user1: FriendshipParticipant;
  user2: FriendshipParticipant;
}

export interface DeletedFriendRequest {
  id: string;
  sender: NotificationTarget;
}

export interface PrivateChatUnreadMessageView {
  count: number;
  message: {
    isTextMessage: boolean;
    url: string | null;
    attachments: Array<{
      secureUrl: string;
    }>;
    isPollMessage: boolean;
    createdAt: Date;
    textMessageContent: string | null;
  };
  sender: FriendRequestParticipant;
}

export interface PrivateChatLatestMessageView {
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
  sender: {
    id: string;
    username: string;
    avatar: string;
  };
  attachments: Array<{
    secureUrl: string;
  }>;
  poll: {
    id: string;
    question: string;
    options: string[];
    multipleAnswers: boolean;
  } | null;
  reactions: Array<{
    reaction: string;
    user: {
      id: string;
      username: string;
      avatar: string;
    };
  }>;
}

export interface PrivateChatView {
  id: string;
  name: string | null;
  isGroupChat: boolean;
  avatar: string;
  adminId: string | null;
  latestMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
  ChatMembers: Array<{
    user: FriendRequestParticipant;
  }>;
  UnreadMessages: PrivateChatUnreadMessageView[];
  latestMessage: PrivateChatLatestMessageView | null;
}

export interface AcceptedPrivateChatView extends PrivateChatView {
  typingUsers: string[];
}
