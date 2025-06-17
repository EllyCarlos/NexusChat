import { useSocket } from "@/context/socket.context";
import { Event } from "@/interfaces/events.interface";

type NewReactionEventReceivePayload = {
  chatId: string;
  messageId: string;
  reaction: string;
};

export const useSendNewReaction = () => {
  const socket = useSocket();

  const sendNewReaction = (data: NewReactionEventReceivePayload) => {
    socket?.emit(Event.NEW_REACTION, data);
  };

  return {
    sendNewReaction,
  };
};
