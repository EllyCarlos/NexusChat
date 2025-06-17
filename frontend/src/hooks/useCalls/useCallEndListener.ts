import { Event } from "@/interfaces/events.interface";
import { selectMyGlobalStream, setIsInCall, setMyGlobalStream } from "@/lib/client/slices/callSlice";
import { setCallDisplay, setInComingCallInfo, setIsIncomingCall } from "@/lib/client/slices/uiSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { useCallback, useEffect } from "react";
import toast from "react-hot-toast";
import { useSocketEvent } from "../useSocket/useSocketEvent";
import { peer } from "@/lib/client/webrtc/services/peer";

export const useCallEndListener = () => {

    const myGlobalStream = useAppSelector(selectMyGlobalStream);
    const dispatch = useAppDispatch();


    useEffect(()=>{
        if(myGlobalStream !== undefined){
            myGlobalStream?.getTracks().forEach((track)=>track.stop());
            setTimeout(() => {
                dispatch(setMyGlobalStream(undefined));
            }, 1000);
        }
    },[dispatch, myGlobalStream])


    const handleCallEndEvent = useCallback(()=>{

        setTimeout(() => {
            dispatch(setCallDisplay(false));
        }, 1000);
        setTimeout(() => {
            peer.closeConnection();
            toast.success("Call ended");
            
            dispatch(setInComingCallInfo(null));
            dispatch(setIsIncomingCall(false));
            dispatch(setIsInCall(false));
        }, 2000);
    },[dispatch])

    useSocketEvent(Event.CALL_END,handleCallEndEvent);
}
