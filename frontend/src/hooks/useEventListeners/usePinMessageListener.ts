import { Event } from "@/interfaces/events.interface"
import { useSocketEvent } from "../useSocket/useSocketEvent"
import { useCallback } from "react";
import { Message } from "@/interfaces/message.interface";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { addNewPinnedMessage } from "@/lib/client/slices/chatSlice";
import { messageApi } from "@/lib/client/rtk-query/message.api";

type PinMessageEventReceivePayload = {
    message: Message
    id: string;
    createdAt: Date;
    updatedAt: Date;
}

export const usePinMessageListener = () => {

    const dispatch = useAppDispatch();

    const handlePinMessage = useCallback((data:PinMessageEventReceivePayload)=>{
        dispatch(addNewPinnedMessage(data));

        dispatch(
            messageApi.util.updateQueryData("getMessagesByChatId",{chatId:data.message.chatId,page:1},(draft)=>{
                const message =  draft.messages.find(msg=>msg.id === data.message.id);
                if(message){
                    message.isPinned = true;
                }
            })
        )
    },[dispatch])

    useSocketEvent(Event.PIN_MESSAGE,handlePinMessage);
}
