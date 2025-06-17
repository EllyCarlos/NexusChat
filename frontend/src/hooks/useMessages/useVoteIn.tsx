import { useSocket } from "@/context/socket.context";
import { Event } from "@/interfaces/events.interface";

type VoteInEventSendPayload = {
  chatId:string
  messageId:string
  optionIndex:number
}

export const useVoteIn = () => {
  const socket = useSocket();
  const handleVoteIn = (data:VoteInEventSendPayload) => {
    socket?.emit(Event.VOTE_IN, data);
  };
  return { handleVoteIn };
};
