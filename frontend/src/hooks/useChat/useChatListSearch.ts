import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { getChatName } from "@/lib/shared/helpers";
import { useEffect, useState } from "react";

type PropTypes = {
  loggedInUserId: string;
  chats: fetchUserChatsResponse[];
};

export const useChatListSearch = ({loggedInUserId,chats}: PropTypes) => {

  const [filteredChats, setFilteredChats] = useState<fetchUserChatsResponse[]>([]);
  const [searchVal, setSearchVal] = useState<string>("");

  useEffect(() => {
    if (searchVal.trim().length) {
      const filteredChats = chats.filter((chat)=>{
        if(chat.isGroupChat){
          return chat.name?.toLowerCase().includes(searchVal.toLowerCase());
        }
        return getChatName(chat,loggedInUserId).toLowerCase().includes(searchVal.toLowerCase());
      })
      setFilteredChats(filteredChats);
    } else if (searchVal.trim().length == 0) {
      setFilteredChats([]);
    }
  }, [chats, loggedInUserId, searchVal]);

  return { filteredChats , searchVal , setSearchVal };
};
