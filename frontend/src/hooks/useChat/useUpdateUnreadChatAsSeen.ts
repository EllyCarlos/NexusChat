import { useSocket } from "@/context/socket.context";
import { Event } from "@/interfaces/events.interface";
import { selectSelectedChatDetails } from "@/lib/client/slices/chatSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { useEffect } from "react";

interface MessageSeenEventPayloadData {
  chatId:string
}

export const useUpdateUnreadMessagesAsSeenOnChatSelect = () => {
  const socket = useSocket();
  const selectedChatDetails = useAppSelector(selectSelectedChatDetails);

  useEffect(() => {
    if (selectedChatDetails && selectedChatDetails.UnreadMessages[0]?.count > 0) {
      const payload: MessageSeenEventPayloadData = {
        chatId: selectedChatDetails.id,
      };
      socket?.emit(Event.MESSAGE_SEEN, payload);
    }
  }, [selectedChatDetails, socket]);
};
