import { useSocket } from "@/context/socket.context";
import { Event } from "@/interfaces/events.interface";

type VoteOutEventSendPayload = {
  chatId:string
  messageId:string
  optionIndex:number
}

export const useVoteOut = () => {
  const socket = useSocket();
  const handleVoteOut = (data:VoteOutEventSendPayload) => {
      socket?.emit(Event.VOTE_OUT, data);
  };
  return { handleVoteOut };
};
