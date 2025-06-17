import { useSocket } from "@/context/socket.context";
import { Event } from "@/interfaces/events.interface";
import { useEffect } from "react";
import { selectSelectedChatDetails } from "../../lib/client/slices/chatSlice";
import { useAppSelector } from "../../lib/client/store/hooks";

type UserTypingEventSendPayload = {
  chatId:string
}

export const useEmitTypingEvent = (isTyping: string) => {
  
  const socket = useSocket();
  const selectedChatDetails = useAppSelector(selectSelectedChatDetails);

  useEffect(() => {
    if (selectedChatDetails && isTyping) {
      const data: UserTypingEventSendPayload = {
        chatId: selectedChatDetails.id,
      };
      socket?.emit(Event.USER_TYPING, data);
    }
  }, [isTyping]);
};
