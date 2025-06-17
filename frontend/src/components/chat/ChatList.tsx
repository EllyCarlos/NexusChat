"use client";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { sortChats } from "@/lib/shared/helpers";
import { ChatListItem } from "./ChatListItem";

type PropTypes = {
  chats: fetchUserChatsResponse[];
  isFiltered: boolean;
};

export const ChatList = ({ chats, isFiltered }: PropTypes) => {
  const sortedChats = isFiltered ? chats : sortChats(chats);

  return (
    <div className="flex flex-col gap-y-4">
      {sortedChats.map(chat => (
        <ChatListItem
          key={`${chat.id}-${chat.latestMessage?.id}`}
          chat={chat}
        />
      ))}
    </div>
  );
};
