import { Event } from "@/interfaces/events.interface";
import { messageApi } from "@/lib/client/rtk-query/message.api";
import { deletePinnedMessageOnMessageDeletion } from "@/lib/client/slices/chatSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { useSocketEvent } from "../useSocket/useSocketEvent";

type MessageDeleteEventReceivePayload = {
  chatId:string
  messageId:string
}


export const useMessageDeleteListener = () => {
  const dispatch = useAppDispatch();

  useSocketEvent(Event.MESSAGE_DELETE,({chatId,messageId}:MessageDeleteEventReceivePayload) => {
    
      dispatch(
        messageApi.util.updateQueryData("getMessagesByChatId",{ chatId, page: 1 },(draft) => {
            draft.messages = draft.messages.filter(message => message.id !== messageId);
          }
        )
      );

      dispatch(deletePinnedMessageOnMessageDeletion({chatId,messageId}))
    }
  );
};
