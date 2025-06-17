import { Event } from "@/interfaces/events.interface";
import { messageApi } from "@/lib/client/rtk-query/message.api";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { useSocketEvent } from "../useSocket/useSocketEvent";

type MessageEditEventReceivePayload = {
  chatId:string
  messageId:string
  updatedTextMessageContent:string
}

export const useMessageEditListener = () => {
  const dispatch = useAppDispatch();

  useSocketEvent(Event.MESSAGE_EDIT,({chatId,messageId,updatedTextMessageContent}: MessageEditEventReceivePayload) => {
      dispatch(
        messageApi.util.updateQueryData("getMessagesByChatId",{ chatId, page: 1 },(draft) => {
            const msg = draft.messages.find((draft) => draft.id === messageId);
            if (msg) {
              msg.isEdited = true;
              msg.textMessageContent = updatedTextMessageContent;
            }
          }
        )
      );
    }
  );
};
