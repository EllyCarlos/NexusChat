// src/context/PeerProvider.tsx

"use client";

import { PeerService } from "@/lib/client/webrtc/services/peer";
import React, { createContext, useContext, useEffect, useMemo, useRef } from "react";

// 1. Define the shape of our context data
interface IPeerContext {
  peerService: PeerService | null;
}

// 2. Create the React Context with a default value
const PeerContext = createContext<IPeerContext>({
  peerService: null,
});

// 3. Create a custom hook for easy access to the context
// This hook will be used by components like CallDisplay
export const usePeer = () => {
  const context = useContext(PeerContext);
  if (!context) {
    throw new Error("usePeer must be used within a PeerServiceProvider");
  }
  return context;
};

// 4. Create the Provider Component
// This component will wrap our chat feature
export const PeerServiceProvider = ({ children }: { children: React.ReactNode }) => {
  // Use a ref to hold the service instance, preventing re-creation on re-renders
  const peerServiceRef = useRef<PeerService | null>(null);

  // Initialize the service only once when the provider mounts on the client
  if (peerServiceRef.current === null && typeof window !== 'undefined') {
      peerServiceRef.current = new PeerService();
  }
  
  // The context value that will be passed down
  const value = {
    peerService: peerServiceRef.current,
  };

  // Ensure we clean up the connection when the provider unmounts
  useEffect(() => {
    const service = peerServiceRef.current;
    return () => {
      console.log("PeerServiceProvider unmounting. Closing connection.");
      service?.closeConnection();
    };
  }, []);

  return <PeerContext.Provider value={value}>{children}</PeerContext.Provider>;
};