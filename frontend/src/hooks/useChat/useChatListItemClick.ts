import {
  selectChats,
  selectSelectedChatDetails,
  updateSelectedChatDetails,
} from "@/lib/client/slices/chatSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { useToggleChatBar } from "../useUI/useToggleChatBar";
import { useMediaQuery } from "../useUtils/useMediaQuery";

// Define the User interface for nested user objects (UPDATED Date types)
interface User {
  id: string;
  avatar: string;
  username: string;
  isOnline: boolean;
  publicKey: string | null;
  lastSeen: Date | null; // Changed to Date | null
  verificationBadge: boolean;
  createdAt: Date; // Added for consistency, assuming user objects have this
  updatedAt: Date; // Added for consistency, assuming user objects have this
}

// Define the Attachment interface for messages
interface MessageAttachment {
  id: string;
  secureUrl: string;
  cloudinaryPublicId: string;
}

// Define the Poll interface for messages
interface MessagePoll {
  question: string;
  options: string[];
  multipleAnswers: boolean;
}

// Define the Reaction interface for messages
interface MessageReaction {
  id: string;
  user: {
    id: string;
    avatar: string;
    username: string;
  };
  reaction: string;
}

// Define the Message interface for latestMessage (UPDATED Date types)
interface Message {
  id: string;
  chatId: string;
  senderId: string;
  textMessageContent: string | null;
  type: string;
  url: string | null;
  audioUrl: string | null;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: Date; // Changed to Date
  updatedAt: Date; // Changed to Date
  isPinned: boolean;

  isTextMessage: boolean;
  isPollMessage: boolean;
  
  reactions: MessageReaction[];
  poll: MessagePoll | null;
  attachments: MessageAttachment[];
  sender: User;
}

// Define the Chat interface to match 'fetchUserChatsResponse' structure (UPDATED Date types)
export interface Chat {
  id: string;
  name: string | null;
  isGroupChat: boolean;
  avatar: string;
  avatarCloudinaryPublicId: string | null;
  adminId: string | null;
  latestMessageId: string | null;
  createdAt: Date; // Changed to Date
  updatedAt: Date; // Changed to Date
  
  ChatMembers: {
    id: string;
    userId: string;
    chatId: string;
    user: User;
  }[];
  PinnedMessages: any[]; // If still causes issues, you'll need to define this interface
  UnreadMessages: any[]; // If still causes issues, you'll need to define this interface
  latestMessage: Message | null;
}

export const useChatListItemClick = () => {
  const dispatch = useAppDispatch();
  const selectedChatId = useAppSelector(selectSelectedChatDetails)?.id;
  const { toggleChatBar } = useToggleChatBar();
  
  const chats: Chat[] | null = useAppSelector(selectChats);

  const isLg = useMediaQuery(1024);

  const handleChatListItemClick = (chatId: string) => {
    if (chatId === selectedChatId) {
      dispatch(updateSelectedChatDetails(null));
    } else if (chatId !== selectedChatId && chats && chats.length) {
      const selectedChatByUser = chats.find((chat: Chat) => chat.id === chatId);
      if (selectedChatByUser) dispatch(updateSelectedChatDetails(selectedChatByUser));
    }
    if (isLg) {
      toggleChatBar();
    }
  };

  return { handleChatListItemClick };
};