'use client';

import { createContext, RefObject, useContext, useRef } from "react";


const MessageInputContext = createContext<RefObject<HTMLTextAreaElement | null> | null>(null);

export const MessageInputProvider = ({ children }:{children: React.ReactNode}) => {

  const messageInputRef = useRef<HTMLTextAreaElement>(null);

  return (
    <MessageInputContext.Provider value={messageInputRef}>
      {children}
    </MessageInputContext.Provider>
  );
};

export const useMessageInputRef = () => useContext(MessageInputContext);
