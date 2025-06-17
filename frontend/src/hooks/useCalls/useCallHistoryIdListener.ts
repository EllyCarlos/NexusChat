import { Event } from "@/interfaces/events.interface";
import { setCallHistoryId } from "@/lib/client/slices/callSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { useCallback } from "react";
import { useSocketEvent } from "../useSocket/useSocketEvent";


type CallIdEventReceivePayload = {
    callHistoryId:string
}

export const useCallHistoryIdListener = () => {

    const dispatch = useAppDispatch();

    const handleCallHistoryIdEvent = useCallback(({callHistoryId}:CallIdEventReceivePayload)=>{
        dispatch(setCallHistoryId(callHistoryId));
    },[dispatch]);

    useSocketEvent(Event.CALL_ID,handleCallHistoryIdEvent);

}
