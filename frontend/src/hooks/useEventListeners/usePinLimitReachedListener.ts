import { Event } from "@/interfaces/events.interface";
import { removePinnedMessage } from "@/lib/client/slices/chatSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { useCallback } from "react";
import toast from "react-hot-toast";
import { useSocketEvent } from "../useSocket/useSocketEvent";
import { messageApi } from "@/lib/client/rtk-query/message.api";

type PinLimitReachedEventReceivePayload = {
    oldestPinId:string,
    messageId:string,
    chatId:string
}

export const usePinLimitReachedListener = () => {

    const dispatch = useAppDispatch();

    const handlePinLimitReachedEvent = useCallback(({oldestPinId,messageId,chatId}:PinLimitReachedEventReceivePayload)=>{

        console.log("pin limit reached event received",{oldestPinId,messageId,chatId});
        toast("Pin limit reached, removing the oldest pin",{icon:"📌"});
        dispatch(removePinnedMessage({pinId:oldestPinId}));

        dispatch(
            messageApi.util.updateQueryData("getMessagesByChatId",{chatId,page:1},(draft)=>{
                const message =  draft.messages.find(msg=>msg.id === messageId);
                if(message){
                    console.log('message found',message);
                    message.isPinned = false;
                }
            })
        )

    },[dispatch])

    useSocketEvent(Event.PIN_LIMIT_REACHED,handlePinLimitReachedEvent);
}
