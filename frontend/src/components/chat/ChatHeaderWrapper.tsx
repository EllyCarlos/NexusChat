"use client";

import { selectSelectedChatDetails } from "@/lib/client/slices/chatSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { ChatHeader } from "./ChatHeader";

export const ChatHeaderWrapper = () => {
  const selectedChatDetails = useAppSelector(selectSelectedChatDetails);
  return selectedChatDetails ? (
    <ChatHeader selectedChatDetails={selectedChatDetails} />
  ) : null;
};
