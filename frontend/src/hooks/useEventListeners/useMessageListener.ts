import { Event } from "@/interfaces/events.interface";
import { Message } from "@/interfaces/message.interface";
// Assuming Chat and BasicUserInfo are defined in central interface files:
import { Chat, BasicUserInfo } from "@/interfaces/chat.interface"; // Adjust path if your Chat interface is elsewhere
// import { BasicUserInfo } from "@/interfaces/user.interface"; // Uncomment and use if BasicUserInfo is in a separate user interface file

import { messageApi } from "@/lib/client/rtk-query/message.api";
import {
  removeUserTyping,
  selectChats,
  selectSelectedChatDetails,
  updateLatestMessage,
} from "@/lib/client/slices/chatSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { useEffect, useRef } from "react";
import { useSocketEvent } from "../useSocket/useSocketEvent";

export const useMessageListener = () => {
  const selectedChatDetails = useAppSelector(selectSelectedChatDetails);
  const selectedChatDetailsRef = useRef(selectedChatDetails);

  useEffect(() => {
    if (selectedChatDetailsRef.current != selectedChatDetails) selectedChatDetailsRef.current = selectedChatDetails;
  }, [selectedChatDetails]);

  const dispatch = useAppDispatch();
  const chats = useAppSelector(selectChats);

  useSocketEvent(Event.MESSAGE, async (newMessage: Message) => {
    dispatch(
      messageApi.util.updateQueryData("getMessagesByChatId",{ chatId: newMessage.chatId, page: 1 },(draft) => {
          draft.messages.push(newMessage);
          if (!draft.totalPages) draft.totalPages = 1;
        }
      )
    );

    // Explicitly type the 'chatItem' parameter as 'Chat'
    const chat = chats.find((chatItem: Chat) => chatItem.id === newMessage.chatId);

    if (chat) {
      dispatch(updateLatestMessage({chatId:newMessage.chatId,newMessage}));

      const isMessageReceivedInSelectedChat = newMessage.chatId === selectedChatDetailsRef.current?.id;

      if (isMessageReceivedInSelectedChat) {
        const ifUserWhoWasTypingHasSentTheMessage = selectedChatDetailsRef.current?.typingUsers.some(({id}) => id === newMessage.sender.id);
        if (ifUserWhoWasTypingHasSentTheMessage) dispatch(removeUserTyping(newMessage.sender.id));
      }
      
      else {
        const ifUserWhoWasTypingHasSentTheMessage = chat?.typingUsers.some(({id}) => id === newMessage.sender.id);
        if (ifUserWhoWasTypingHasSentTheMessage){
          // Make sure chat.typingUsers is handled immutably if chat is part of Redux state
          // For direct modification here, ensure chat object is mutable or copy it
          // Or, better, dispatch an action to update typingUsers in Redux
          const updatedTypingUsers = chat.typingUsers.filter((user) => user.id !== newMessage.sender.id);
          // Assuming an action like updateChatTypingUsers exists
          // dispatch(updateChatTypingUsers({ chatId: chat.id, typingUsers: updatedTypingUsers }));
          // If direct mutation is acceptable in this context (e.g., if 'chat' is a draft from Immer),
          // then the line below would be fine. If not, it could lead to state mutation issues outside Redux.
          chat.typingUsers = updatedTypingUsers; // Direct mutation, be cautious
        }
      }
    }
  });
};
