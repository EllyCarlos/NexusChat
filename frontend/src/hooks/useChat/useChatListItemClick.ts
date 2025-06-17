import {
  selectChats,
  selectSelectedChatDetails,
  updateSelectedChatDetails,
} from "@/lib/client/slices/chatSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { useToggleChatBar } from "../useUI/useToggleChatBar";
import { useMediaQuery } from "../useUtils/useMediaQuery";

export const useChatListItemClick = () => {

  const dispatch = useAppDispatch();
  const selectedChatId = useAppSelector(selectSelectedChatDetails)?.id;
  const { toggleChatBar } = useToggleChatBar();
  const chats = useAppSelector(selectChats);

  const isLg = useMediaQuery(1024);

  const handleChatListItemClick = (chatId: string) => {
    if(chatId === selectedChatId) {
      dispatch(updateSelectedChatDetails(null));
    }
    else if(chatId !== selectedChatId && chats && chats.length) {
      const selectedChatByUser = chats.find((chat) => chat.id === chatId);
      if (selectedChatByUser) dispatch(updateSelectedChatDetails(selectedChatByUser));
    }
    if (isLg) {
      toggleChatBar();
    }
  };

  return { handleChatListItemClick };
};
