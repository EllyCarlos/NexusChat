import { Event } from "@/interfaces/events.interface";
import { messageApi } from "@/lib/client/rtk-query/message.api";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { useSocketEvent } from "../useSocket/useSocketEvent";

type DeleteReactionEventReceivePayload = {
  chatId:string
  messageId:string
  userId:string
}


export const useDeleteReactionListener = () => {

  const dispatch = useAppDispatch();

  useSocketEvent(Event.DELETE_REACTION,({ chatId, messageId, userId }: DeleteReactionEventReceivePayload) => {
      dispatch(
        messageApi.util.updateQueryData("getMessagesByChatId",{ chatId, page: 1 },(draft) => {
            const message = draft.messages.find(draft => draft.id === messageId);
            if (message && message.reactions.length) {
              const reactionToBeRemovedIndex = message.reactions.findIndex((reaction) => reaction.user.id === userId);
              if (reactionToBeRemovedIndex !== -1)
                message.reactions.splice(reactionToBeRemovedIndex, 1);
            }
          }
        )
      );
    }
  );
};
