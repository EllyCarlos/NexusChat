import { useGetFriendsQuery } from "@/lib/client/rtk-query/friend.api";
import { fetchUserFriendsResponse } from "@/lib/server/services/userService";
import { useEffect, useState } from "react";

type PropTypes = {
  searchVal: string;
};

export const useFilteredFriends = ({ searchVal }: PropTypes) => {
  const [filteredFriends, setFilteredFriends] = useState<fetchUserFriendsResponse[]>([]);
  const { data: friends } = useGetFriendsQuery();

  useEffect(() => {
    if (friends) {
      setFilteredFriends(
        friends.filter((friend) =>
          friend.username.toLowerCase().includes(searchVal.toLowerCase())
        )
      );
    }
  }, [searchVal, friends]);

  return { filteredFriends, setFilteredFriends };
};
