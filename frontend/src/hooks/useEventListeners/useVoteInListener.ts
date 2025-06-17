import { Event } from "@/interfaces/events.interface";
import { messageApi } from "@/lib/client/rtk-query/message.api";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { useSocketEvent } from "../useSocket/useSocketEvent";

type VoteInEventReceivePayload = {
  messageId:string
  user:{
      id:string
      avatar:string
      username:string
  }
  optionIndex:number
  chatId:string
}


export const useVoteInListener = () => {

  const dispatch = useAppDispatch();

  useSocketEvent(Event.VOTE_IN,({messageId,optionIndex,user,chatId}: VoteInEventReceivePayload) => {

        dispatch(
          messageApi.util.updateQueryData("getMessagesByChatId",{ chatId, page: 1 },(draft) => {
              const message = draft.messages.find(draft => draft.id === messageId);
              if (message && message.isPollMessage) {
                message.poll?.votes.push({user,optionIndex})
              }
            }
          )
        );     
    }
  );
};
