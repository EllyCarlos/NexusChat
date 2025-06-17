import { Event } from "@/interfaces/events.interface";
import { messageApi } from "@/lib/client/rtk-query/message.api";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { useSocketEvent } from "../useSocket/useSocketEvent";

type NewReactionEventReceivePayload = {
  chatId:string
  messageId:string
  user:{
      id:string
      username:string
      avatar:string
  }
  reaction:string
}

export const useNewReactionListener = () => {
  const dispatch = useAppDispatch();

  useSocketEvent(Event.NEW_REACTION,({chatId,messageId,reaction,user}: NewReactionEventReceivePayload) => {
      dispatch(
        messageApi.util.updateQueryData("getMessagesByChatId",{ chatId, page: 1 },(draft) => {
            const message = draft.messages.find(draft => draft.id === messageId);
            if (message) message.reactions.push({ user, reaction });
          }
        )
      );
    }
  );
};
