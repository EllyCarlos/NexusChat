// src/hooks/useCalls/useCallEndListener.ts (Corrected)

import { usePeer } from "@/context/PeerProvider"; // NEW: Import our context hook
import { Event } from "@/interfaces/events.interface";
import { selectMyGlobalStream, setIsInCall, setMyGlobalStream } from "@/lib/client/slices/callSlice";
import { setCallDisplay, setInComingCallInfo, setIsIncomingCall } from "@/lib/client/slices/uiSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { useCallback, useEffect } from "react";
import toast from "react-hot-toast";
import { useSocketEvent } from "../useSocket/useSocketEvent";
// REMOVED: No more direct import from peer.ts

export const useCallEndListener = () => {
    const myGlobalStream = useAppSelector(selectMyGlobalStream);
    const dispatch = useAppDispatch();

    // NEW: Get the peerService instance from the context.
    const { peerService } = usePeer();

    useEffect(() => {
        if (myGlobalStream !== undefined) {
            // FIX: Explicitly type 'track' as MediaStreamTrack
            myGlobalStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
            setTimeout(() => {
                dispatch(setMyGlobalStream(undefined));
            }, 1000);
        }
    }, [dispatch, myGlobalStream]);

    const handleCallEndEvent = useCallback(() => {
        setTimeout(() => {
            dispatch(setCallDisplay(false));
        }, 1000);

        setTimeout(() => {
            // NEW: Use the peerService instance from the usePeer() hook.
            // It's already available here, no need to "get" it.
            peerService?.closeConnection();

            toast.success("Call ended");
            dispatch(setInComingCallInfo(null));
            dispatch(setIsIncomingCall(false));
            dispatch(setIsInCall(false));
        }, 2000);
    // CHANGED: Add `peerService` to the dependency array.
    }, [dispatch, peerService]);

    useSocketEvent(Event.CALL_END, handleCallEndEvent);
};