import { Event } from "@/interfaces/events.interface";
import { messageApi } from "@/lib/client/rtk-query/message.api";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { useSocketEvent } from "../useSocket/useSocketEvent";

type VoteOutEventReceivePayload = {
  chatId:string
  messageId:string
  userId:string
  optionIndex:number
}

export const useVoteOutListener = () => {

  const dispatch = useAppDispatch();

  useSocketEvent(Event.VOTE_OUT,({chatId,messageId,userId,optionIndex}: VoteOutEventReceivePayload) => {

      dispatch(
        messageApi.util.updateQueryData("getMessagesByChatId",{ chatId, page: 1 },(draft) => {

            const message = draft.messages.find(draft => draft.id === messageId);

            if (message && message.isPollMessage && message.poll?.votes){

              const fitleredVotes:{
                user:{
                  id:string
                  avatar:string
                  username:string
                }
                optionIndex:number
              }[] = [];

              message.poll.votes.map(vote=>{
                if(vote.user.id === userId && vote.optionIndex === optionIndex){
                  
                }
                else{
                  fitleredVotes.push(vote);
                }
              })
              message.poll.votes = fitleredVotes;
            }
          }
        )
      );
      
    }
  );
};
