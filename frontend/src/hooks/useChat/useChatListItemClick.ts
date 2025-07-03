import {
  selectChats,
  selectSelectedChatDetails,
  updateSelectedChatDetails,
} from "@/lib/client/slices/chatSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { useToggleChatBar } from "../useUI/useToggleChatBar";
import { useMediaQuery } from "../useUtils/useMediaQuery";

// Define the User interface for nested user objects (unchanged from last time)
interface User {
  id: string;
  avatar: string;
  username: string;
  isOnline: boolean;
  publicKey: string | null;
  lastSeen: Date | null;
  verificationBadge: boolean;
  // Add any other user properties as they appear in your data
}

// Define the Attachment interface for messages
interface MessageAttachment {
  id: string; // Assuming attachments have their own ID
  secureUrl: string;
  cloudinaryPublicId: string;
  // Add other properties if your message attachments have them (e.g., mimeType, size)
}

// Define the Poll interface for messages
interface MessagePoll {
  question: string;
  options: string[];
  multipleAnswers: boolean;
  // Add other properties if your message polls have them
}

// Define the Reaction interface for messages
interface MessageReaction {
  id: string; // Reaction ID
  user: { // Simplified user object for reactions, as hinted by error log
    id: string;
    avatar: string;
    username: string;
  };
  reaction: string; // The emoji or text of the reaction
}


// Define the Message interface for latestMessage (EXPANDED)
interface Message {
  id: string;
  content: string;
  senderId: string;
  chatId: string;
  createdAt: string; // Assuming it's a string representation of Date
  updatedAt: string;
  isDeleted: boolean;
  isEdited: boolean;
  type: string; // e.g., 'text', 'image', 'video', 'poll'

  // NEW properties required by fetchUserChatsResponse for latestMessage
  reactions: MessageReaction[]; // Array of reactions
  poll: MessagePoll | null; // Can be null if no poll
  attachments: MessageAttachment[]; // Array of attachments
  sender: User; // The sender of the message (full User object or a subset)
}

// Define the Chat interface to match 'fetchUserChatsResponse' structure (unchanged from last time)
export interface Chat {
  id: string;
  name: string | null;
  isGroupChat: boolean;
  avatar: string;
  avatarCloudinaryPublicId: string | null;
  adminId: string | null;
  latestMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  
  ChatMembers: {
    id: string;
    userId: string;
    chatId: string;
    user: User;
  }[];
  PinnedMessages: any[]; // Consider defining a proper interface if you encounter errors here
  UnreadMessages: any[]; // Consider defining a proper interface if you encounter errors here
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