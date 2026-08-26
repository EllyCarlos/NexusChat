import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { getChatName } from "@/lib/shared/helpers";
import { useMemo, useState } from "react";

type PropTypes = {
  loggedInUserId: string;
  chats: fetchUserChatsResponse[];
};

export const useChatListSearch = ({loggedInUserId,chats}: PropTypes) => {

  const [searchVal, setSearchVal] = useState<string>("");

  const filteredChats = useMemo(() => {
    if (!searchVal.trim()) {
      return [];
    }

    return chats.filter((chat) => {
      if (chat.isGroupChat) {
        return chat.name?.toLowerCase().includes(searchVal.toLowerCase());
      }
      return getChatName(chat, loggedInUserId).toLowerCase().includes(searchVal.toLowerCase());
    });
  }, [chats, loggedInUserId, searchVal]);

  return { filteredChats , searchVal , setSearchVal };
};
