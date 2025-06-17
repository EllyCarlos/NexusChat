import { useSocket } from "@/context/socket.context";
import { Event } from "@/interfaces/events.interface";

type DeleteReactionEventSendPayload = {
  chatId: string;
  messageId: string;
};

export const useDeleteReaction = () => {
  const socket = useSocket();

  const deleteReaction = (data: DeleteReactionEventSendPayload) => {
    socket?.emit(Event.DELETE_REACTION, data);
  };
  return {
    deleteReaction,
  };
};
