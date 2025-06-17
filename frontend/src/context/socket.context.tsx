"use client";
import React, { createContext, useContext, useRef, useState } from "react";
import io, { Socket } from "socket.io-client";
import { selectAuthToken, selectLoggedInUser } from "../lib/client/slices/authSlice";
import { useAppSelector } from "../lib/client/store/hooks";

const socketContext = createContext<Socket | null>(null);

export const useSocket = () => useContext(socketContext);

type PropTypes = { children: React.ReactNode };

export const SocketProvider = ({ children }: PropTypes) => {
  const token = useAppSelector(selectAuthToken);
  const loggedInUser = useAppSelector(selectLoggedInUser);

  const socketRef = useRef<Socket | null>(null); // Persistent instance
  const [, setIsConnected] = useState(false);

  if (typeof window !== "undefined" && loggedInUser && token && !socketRef.current) {
    try {
      socketRef.current = io(process.env.NEXT_PUBLIC_ABSOLUTE_BASE_URL, {
        withCredentials: true,
        query: { token },
      });

      socketRef.current.on("connect", () => setIsConnected(true));
      socketRef.current.on("disconnect", () => setIsConnected(false));
      socketRef.current.on("connect_error", (error) => console.error("Socket error:", error));
    } catch (error) {
      console.error("Socket error:", error);
    }
  }

  return (
    <socketContext.Provider value={socketRef.current}>
      {children}
    </socketContext.Provider>
  );
};
