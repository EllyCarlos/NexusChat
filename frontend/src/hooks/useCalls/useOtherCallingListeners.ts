import { Event } from "@/interfaces/events.interface";
import { useCallback } from "react";
import toast from "react-hot-toast";
import { useSocketEvent } from "../useSocket/useSocketEvent";

export const useOtherCallingListeners = () => {
  const handleCallRejected = useCallback(() => {
    toast.error("Call declined");
  }, []);

  const handleCalleeOffline = useCallback(() => {
    toast.error("User is offline");
  }, []);

  const handleCalleeBusy = useCallback(() => {
    toast.error("User is busy");
  }, []);

  const handleCallerOffline = useCallback(() => {
    toast.error("Caller is offline");
    toast.success("Missed called notification sent");
  }, []);

  useSocketEvent(Event.CALLEE_OFFLINE, handleCalleeOffline);
  useSocketEvent(Event.CALLEE_BUSY, handleCalleeBusy);
  useSocketEvent(Event.CALLER_OFFLINE, handleCallerOffline);
  useSocketEvent(Event.CALL_REJECTED, handleCallRejected);
};
