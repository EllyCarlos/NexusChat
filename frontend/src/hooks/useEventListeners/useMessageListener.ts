import { Event } from "@/interfaces/events.interface";
import { Message } from "@/interfaces/message.interface"; 
// Import Chat and BasicUserInfo from where they are now exported
import { Chat, BasicUserInfo } from "../useChat/useChatListItemClick"; 

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

    const chat = chats.find((chatItem: Chat) => chatItem.id === newMessage.chatId);

    if (chat) {
      dispatch(updateLatestMessage({chatId:newMessage.chatId,newMessage}));

      const isMessageReceivedInSelectedChat = newMessage.chatId === selectedChatDetailsRef.current?.id;

      if (isMessageReceivedInSelectedChat) {
        // Explicitly type the destructured parameter 'id' by providing the type for the object ({id}: BasicUserInfo)
        const ifUserWhoWasTypingHasSentTheMessage = selectedChatDetailsRef.current?.typingUsers.some(({id}: BasicUserInfo) => id === newMessage.sender.id);
        if (ifUserWhoWasTypingHasSentTheMessage) dispatch(removeUserTyping(newMessage.sender.id));
      }
      
      else {
        // Apply the same explicit typing here for consistency and correctness
        const ifUserWhoWasTypingHasSentTheMessage = chat?.typingUsers.some(({id}: BasicUserInfo) => id === newMessage.sender.id);
        if (ifUserWhoWasTypingHasSentTheMessage){
          const updatedTypingUsers = chat.typingUsers.filter((user) => user.id !== newMessage.sender.id);
          chat.typingUsers = updatedTypingUsers; 
        }
      }
    }
  });
};
