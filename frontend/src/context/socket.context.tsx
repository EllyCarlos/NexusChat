"use client";
import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import io, { Socket } from "socket.io-client";
import { selectAuthToken, selectLoggedInUser } from "../lib/client/slices/authSlice";
import { useAppSelector } from "../lib/client/store/hooks";

const socketContext = createContext<Socket | null>(null);

export const useSocket = () => useContext(socketContext);

type PropTypes = { children: React.ReactNode };

export const createSocketStore = () => {
  let currentSocket: Socket | null = null;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return currentSocket;
    },
    setSocket(nextSocket: Socket | null) {
      if (currentSocket === nextSocket) return;
      currentSocket = nextSocket;
      listeners.forEach((listener) => listener());
    },
  };
};

const getServerSocketSnapshot = () => null;

export const SocketProvider = ({ children }: PropTypes) => {
  const token = useAppSelector(selectAuthToken);
  const loggedInUser = useAppSelector(selectLoggedInUser);
  const loggedInUserId = loggedInUser?.id;

  const [socketStore] = useState(() => createSocketStore());
  const socket = useSyncExternalStore(
    socketStore.subscribe,
    socketStore.getSnapshot,
    getServerSocketSnapshot
  );

  useEffect(() => {
    if (!loggedInUserId || !token) {
      return;
    }

    let nextSocket: Socket;
    try {
      nextSocket = io(process.env.NEXT_PUBLIC_ABSOLUTE_BASE_URL, {
        withCredentials: true,
        query: { token },
      });

      const handleConnectError = (error: Error) => console.error("Socket error:", error);

      nextSocket.on("connect_error", handleConnectError);
      socketStore.setSocket(nextSocket);

      return () => {
        if (socketStore.getSnapshot() === nextSocket) {
          socketStore.setSocket(null);
        }
        nextSocket.disconnect();
        nextSocket.off("connect_error", handleConnectError);
      };
    } catch (error) {
      console.error("Socket error:", error);
    }
  }, [loggedInUserId, socketStore, token]);

  return (
    <socketContext.Provider value={socket}>
      {children}
    </socketContext.Provider>
  );
};
