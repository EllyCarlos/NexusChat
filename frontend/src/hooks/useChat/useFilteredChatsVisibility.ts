import { fetchUserChatsResponse } from "@/lib/server/services/userService";

type PropTypes = {
  searchVal: string;
  filteredChats: fetchUserChatsResponse[];
};

export const useFilteredChatsVisibility = ({filteredChats,searchVal}: PropTypes) => {

  const showFilteredChats = filteredChats.length > 0 || searchVal.trim().length > 0;

  return { showFilteredChats };
};
