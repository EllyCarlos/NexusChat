import { useSocket } from "@/context/socket.context";
import { Event } from "@/interfaces/events.interface";
import { useEffect, useEffectEvent } from "react";

export const useSocketEvent = (eventName: Event, callback: any) => {
  const socket = useSocket();
  const handleEvent = useEffectEvent(callback);

  useEffect(() => {
    if (socket) {
      socket.on(eventName, handleEvent);
    }
    return () => {
      socket?.off(eventName, handleEvent);
    };
  }, [eventName, socket]);
};
