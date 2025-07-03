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
  lastSeen: Date | null;
  verificationBadge: boolean;
  // Add any other user properties as they appear in your data
}

// Define the Message interface for latestMessage
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
  // Add other properties that your Message objects might have
}

// Define the Chat interface to match 'fetchUserChatsResponse' structure
export interface Chat { // Exported in case it's used elsewhere
  id: string;
  name: string | null;
  isGroupChat: boolean;
  avatar: string;
  avatarCloudinaryPublicId: string | null;
  adminId: string | null;
  latestMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  
  // Properties required by fetchUserChatsResponse as per the error message
  ChatMembers: {
    id: string; // ChatMembers ID
    userId: string;
    chatId: string;
    user: User; // Nested user object
  }[];
  PinnedMessages: any[]; // Placeholder, define a PinnedMessage interface if structured
  UnreadMessages: any[]; // Placeholder, define an UnreadMessage interface if structured
  latestMessage: Message | null; // Can be null if no messages yet
}

export const useChatListItemClick = () => {
  const dispatch = useAppDispatch();
  const selectedChatId = useAppSelector(selectSelectedChatDetails)?.id;
  const { toggleChatBar } = useToggleChatBar();
  
  // Ensure that selectChats returns an array of the fully defined Chat objects
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