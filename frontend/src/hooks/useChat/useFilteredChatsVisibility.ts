import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { useEffect, useState } from "react";

type PropTypes = {
  searchVal: string;
  filteredChats: fetchUserChatsResponse[];
};

export const useFilteredChatsVisibility = ({filteredChats,searchVal}: PropTypes) => {

  const [showFilteredChats, setShowFilteredChats] = useState<boolean>(false);
  
  useEffect(() => {
    if (filteredChats.length) {
      // great, that means user has typed something
      // and we have filtered chats
      // so we will show the filtered chats
      setShowFilteredChats(true);
    } else if (filteredChats.length == 0) {
      // if there any no filtered chats then there can be two cases
      // 1. user has not typed anything
      // 2. user has typed something but there are no filteredChats matching the search

      // handling the first case
      if (searchVal.trim().length == 0) {
        setShowFilteredChats(false);
      } else if (searchVal.trim().length > 0) {
        // handling the second case
        // it means user has typed something but there are no filteredChats matching the search
        // so we will show the filteredChats as it is
        setShowFilteredChats(true);
      }
    }
  }, [searchVal, filteredChats]);

  return { showFilteredChats };
};
