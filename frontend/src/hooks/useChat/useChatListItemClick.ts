import {
  selectChats,
  selectSelectedChatDetails,
  updateSelectedChatDetails,
} from "@/lib/client/slices/chatSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { useToggleChatBar } from "../useUI/useToggleChatBar";
import { useMediaQuery } from "../useUtils/useMediaQuery";

// Define the Chat interface based on your database schema or how chat objects are structured.
// This interface should match the data shape returned by your `selectChats` selector.
interface Chat {
  id: string;
  name: string | null;
  isGroupChat: boolean;
  avatar: string;
  // Include any other properties that exist on your chat objects
  latestMessageId?: string | null;
  createdAt: string; // Assuming these are dates converted to string or ISO strings
  updatedAt: string;
  // Add other fields from your Chat model if necessary for full type safety
}

export const useChatListItemClick = () => {
  const dispatch = useAppDispatch();
  const selectedChatId = useAppSelector(selectSelectedChatDetails)?.id;
  const { toggleChatBar } = useToggleChatBar();
  // Ensure that selectChats returns an array of Chat objects
  const chats: Chat[] | null = useAppSelector(selectChats);

  const isLg = useMediaQuery(1024);

  const handleChatListItemClick = (chatId: string) => {
    if (chatId === selectedChatId) {
      dispatch(updateSelectedChatDetails(null));
    } else if (chatId !== selectedChatId && chats && chats.length) {
      // FIX: Explicitly type 'chat' as Chat
      const selectedChatByUser = chats.find((chat: Chat) => chat.id === chatId);
      if (selectedChatByUser) dispatch(updateSelectedChatDetails(selectedChatByUser));
    }
    if (isLg) {
      toggleChatBar();
    }
  };

  return { handleChatListItemClick };
};
