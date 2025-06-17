import { useSocket } from "@/context/socket.context";
import { Event } from "@/interfaces/events.interface";
import { selectIsInCall, setIsInCall } from "@/lib/client/slices/callSlice";
import { setCallDisplay, setInComingCallInfo, setIsIncomingCall } from "@/lib/client/slices/uiSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { useCallback, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { useSocketEvent } from "../useSocket/useSocketEvent";


export type IncomingCallEventReceivePayload = {
    caller: {
      id:string;
      username:string;
      avatar:string;
    };
    offer: RTCSessionDescriptionInit;
    callHistoryId:string
};

type CalleeBusyEventSendPayload = {
    callerId:string;
}

export const useIncomingCallListener = () => {

    const dispatch = useAppDispatch();
    const isInCall = useAppSelector(selectIsInCall);
    const socket = useSocket();

    const isInCallRef = useRef(isInCall);

    useEffect(()=>{
        isInCallRef.current = isInCall;
    },[isInCall])

    const hanleIncomingCall = useCallback(async(data:IncomingCallEventReceivePayload)=>{

        if(isInCallRef.current){
            // if already in call, send busy signal to caller
            const payload:CalleeBusyEventSendPayload = {
                callerId:data.caller.id
            }
            toast(`${data.caller.username} tried calling you`);
            socket?.emit(Event.CALLEE_BUSY,payload)
            return;
        }

        toast.success("Incoming call event received");
        dispatch(setIsInCall(true));
        dispatch(setIsIncomingCall(true));
        dispatch(setInComingCallInfo(data));
        dispatch(setCallDisplay(true));
    },[dispatch, socket])

    useSocketEvent(Event.INCOMING_CALL,hanleIncomingCall);

}
