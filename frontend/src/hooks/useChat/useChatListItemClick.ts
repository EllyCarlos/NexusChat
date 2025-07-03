import {
  selectChats,
  selectSelectedChatDetails,
  updateSelectedChatDetails,
} from "@/lib/client/slices/chatSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { useToggleChatBar } from "../useUI/useToggleChatBar";
import { useMediaQuery } from "../useUtils/useMediaQuery";

// Define the User interface for nested user objects
interface User {
  id: string;
  avatar: string;
  username: string;
  isOnline: boolean;
  publicKey: string | null;
  lastSeen: Date | null; // Assuming Date object or ISO string
  verificationBadge: boolean;
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

// Define the Message interface for latestMessage (FULLY EXPANDED)
// This interface combines all properties observed in previous error logs
// and aligns with a typical Prisma-generated message object with relations included.
interface Message {
  id: string;
  chatId: string;
  senderId: string;
  content: string | null; // Corresponds to textMessageContent
  type: string; // e.g., 'TEXT', 'IMAGE', 'POLL', 'AUDIO', 'VIDEO'
  url: string | null; // For images, video, general files (also covers audioUrl if used for that)
  audioUrl: string | null; // Explicitly added as it was mentioned
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: string; // Or Date if converted to Date objects
  updatedAt: string; // Or Date if converted to Date objects
  isPinned: boolean;

  // Derived properties or flags (as seen in the error's expected type)
  isTextMessage: boolean;
  isPollMessage: boolean;
  
  // Related entities/nested objects (as seen in previous error logs)
  reactions: MessageReaction[];
  poll: MessagePoll | null;
  attachments: MessageAttachment[];
  sender: User; // The sender of the message
}

// Define the Chat interface to match 'fetchUserChatsResponse' structure
export interface Chat {
  id: string;
  name: string | null;
  isGroupChat: boolean;
  avatar: string;
  avatarCloudinaryPublicId: string | null;
  adminId: string | null;
  latestMessageId: string | null;
  createdAt: string; // Or Date
  updatedAt: string; // Or Date
  
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