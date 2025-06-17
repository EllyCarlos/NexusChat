import { useSocket } from "@/context/socket.context";
import { Event } from "@/interfaces/events.interface";
import { selectSelectedChatDetails, updateUnreadMessages } from "@/lib/client/slices/chatSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { useEffect, useRef } from "react";
import { useSocketEvent } from "../useSocket/useSocketEvent";

interface UnreadMessageEventReceivePayload {
  chatId:string,
  message?:{
      textMessageContent?:string | undefined | null
      url?:boolean | undefined | null
      attachments?:boolean
      poll?:boolean
      audio?:boolean
      createdAt:Date
  },
  sender:{
      id:string,
      avatar:string,
      username:string
  }
}

export const useUnreadMessageListener = () => {

  const socket = useSocket();
  const dispatch = useAppDispatch();

  const selectedChatId = useAppSelector(selectSelectedChatDetails)?.id;
  const selectedChatIdRef = useRef(selectedChatId);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  useSocketEvent(Event.UNREAD_MESSAGE,({chatId,sender,message}: UnreadMessageEventReceivePayload) => {

      const selectedChatId = selectedChatIdRef.current;

      if (chatId === selectedChatId) {
        // if the unread message event is for the chat
        // that the user has already opened currently, emit a message seen event
        // signaling that the user has seen the message
        const payload = { chatId: selectedChatId };
        socket?.emit(Event.MESSAGE_SEEN, payload);
      } 
      else {
        // if the message has come is in a chat, that the user has not opened actively currently
        // update the unread message count in the chat list
        dispatch(updateUnreadMessages({chatId,sender,message}))
      }
    }
  );
};
