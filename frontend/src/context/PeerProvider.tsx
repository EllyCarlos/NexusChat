// src/context/PeerProvider.tsx

"use client";

import { PeerService } from "@/lib/client/webrtc/services/peer";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

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
  const [peerService] = useState<PeerService | null>(() =>
    typeof window !== "undefined" ? new PeerService() : null
  );
  
  // The context value that will be passed down
  const value = useMemo(() => ({ peerService }), [peerService]);

  // Ensure we clean up the connection when the provider unmounts
  useEffect(() => {
    return () => {
      console.log("PeerServiceProvider unmounting. Closing connection.");
      peerService?.closeConnection();
    };
  }, [peerService]);

  return <PeerContext.Provider value={value}>{children}</PeerContext.Provider>;
};
