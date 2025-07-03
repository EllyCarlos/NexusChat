import {
  selectChats,
  selectSelectedChatDetails,
  updateSelectedChatDetails,
} from "@/lib/client/slices/chatSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { useToggleChatBar } from "../useUI/useToggleChatBar";
import { useMediaQuery } from "../useUtils/useMediaQuery";

// Define the BasicUserInfo interface (NOW EXPORTED)
export interface BasicUserInfo {
  id: string;
  avatar: string;
  username: string;
}

// Define the User interface for nested user objects (NOW EXPORTED)
export interface User {
  id: string;
  avatar: string;
  username: string;
  isOnline: boolean;
  publicKey: string | null;
  lastSeen: Date | null;
  verificationBadge: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Define the Attachment interface for messages (NOW EXPORTED if used independently, otherwise can stay internal)
export interface MessageAttachment {
  id: string;
  secureUrl: string;
  cloudinaryPublicId: string;
}

// Define the Poll interface for messages (NOW EXPORTED if used independently, otherwise can stay internal)
export interface MessagePoll {
  question: string;
  options: string[];
  multipleAnswers: boolean;
}

// Define the Reaction interface for messages (NOW EXPORTED if used independently, otherwise can stay internal)
export interface MessageReaction {
  id: string;
  user: {
    id: string;
    avatar: string;
    username: string;
  };
  reaction: string;
}

// Define the Message interface for latestMessage (NOW EXPORTED if used independently, otherwise can stay internal)
// NOTE: If you are already importing Message from "@/interfaces/message.interface",
// you might want to remove this local definition to avoid conflicts,
// and ensure the external file has all necessary sub-interfaces.
export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  textMessageContent: string | null;
  type: string;
  url: string | null;
  audioUrl: string | null;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  isPinned: boolean;

  isTextMessage: boolean;
  isPollMessage: boolean;
  
  reactions: MessageReaction[];
  poll: MessagePoll | null;
  attachments: MessageAttachment[];
  sender: User;
}

// Define the Chat interface to match 'fetchUserChatsResponse' structure (NOW EXPORTED)
export interface Chat {
  id: string;
  name: string | null;
  isGroupChat: boolean;
  avatar: string;
  avatarCloudinaryPublicId: string | null;
  adminId: string | null;
  latestMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
  
  ChatMembers: {
    id: string;
    userId: string;
    chatId: string;
    user: User;
  }[];
  PinnedMessages: any[]; 
  UnreadMessages: any[]; 
  latestMessage: Message | null;
  
  typingUsers: BasicUserInfo[]; 
}

export const useChatListItemClick = () => {
  const dispatch = useAppDispatch();
  const selectedChatId = useAppSelector(selectSelectedChatDetails)?.id;
  const { toggleChatBar } = useToggleChatBar();
  
  const chats = useAppSelector(selectChats);

  const isLg = useMediaQuery(1024);

  const handleChatListItemClick = (chatId: string) => {
    if (chatId === selectedChatId) {
      dispatch(updateSelectedChatDetails(null));
    } else if (chatId !== selectedChatId && chats && chats.length) {
      const selectedChatByUser = chats.find((chat) => chat.id === chatId);

      if (selectedChatByUser) dispatch(updateSelectedChatDetails(selectedChatByUser));
    }
    if (isLg) {
      toggleChatBar();
    }
  };

  return { handleChatListItemClick };
};