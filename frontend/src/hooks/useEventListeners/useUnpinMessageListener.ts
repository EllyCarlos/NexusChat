import { Event } from "@/interfaces/events.interface";
import { removePinnedMessage } from "@/lib/client/slices/chatSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { useCallback } from "react";
import { useSocketEvent } from "../useSocket/useSocketEvent";
import { messageApi } from "@/lib/client/rtk-query/message.api";

type UnpinMessageEventReceivePayload = {
    pinId:string
    chatId:string
    messageId:string
}

export const useUnpinMessageListener = () => {

    const dispatch = useAppDispatch();

    const handleUnpinMessageEvent = useCallback(({pinId,chatId,messageId}:UnpinMessageEventReceivePayload)=>{
        dispatch(removePinnedMessage({pinId}));

        dispatch(
            messageApi.util.updateQueryData("getMessagesByChatId",{chatId,page:1},(draft)=>{
                const message =  draft.messages.find(msg=>msg.id === messageId);
                if(message){
                    message.isPinned = false;
                }
            })
        )
    },[dispatch])

    useSocketEvent(Event.UNPIN_MESSAGE,handleUnpinMessageEvent);
}
