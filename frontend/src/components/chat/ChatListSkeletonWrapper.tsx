"use client";
import { selectChats } from "@/lib/client/slices/chatSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { ChatListWithSearchInput } from "./ChatListWithSearchInput";

export const ChatListSkeletonWrapper = () => {

  const chats =  useAppSelector(selectChats);
  return  <ChatListWithSearchInput chats={chats} />
};
