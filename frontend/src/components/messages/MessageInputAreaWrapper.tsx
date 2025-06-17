"use client";

import { selectSelectedChatDetails } from "@/lib/client/slices/chatSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { MessageInputArea } from "../chat/MessageInputArea";

export const MessageInputAreaWrapper = () => {
  const selectedChatDetails = useAppSelector(selectSelectedChatDetails);
  return selectedChatDetails ? (
    <MessageInputArea selectedChatDetails={selectedChatDetails} />
  ) : null;
};
