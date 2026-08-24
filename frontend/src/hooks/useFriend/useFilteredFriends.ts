import { useGetFriendsQuery } from "@/lib/client/rtk-query/friend.api";
import { fetchUserFriendsResponse } from "@/lib/server/services/userService";
import { useMemo } from "react";

type PropTypes = {
  searchVal: string;
};

export const useFilteredFriends = ({ searchVal }: PropTypes) => {
  const { data: friends } = useGetFriendsQuery();

  const filteredFriends = useMemo<fetchUserFriendsResponse[]>(() => {
    return (friends ?? []).filter((friend) =>
      friend.username.toLowerCase().includes(searchVal.toLowerCase())
    );
  }, [searchVal, friends]);

  return { filteredFriends };
};
