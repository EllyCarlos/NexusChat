import { friendApi } from "@/lib/client/rtk-query/friend.api";
import { requestApi } from "@/lib/client/rtk-query/request.api";
import { updateLoggedInUser } from "@/lib/client/slices/authSlice";
import { setCallHistory } from "@/lib/client/slices/callSlice";
import { setChats } from "@/lib/client/slices/chatSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { fetchUserCallHistoryResponse } from "@/lib/server/services/callService";
import {
  fetchUserChatsResponse,
  fetchUserFriendRequestResponse,
  fetchUserFriendsResponse,
  FetchUserInfoResponse,
} from "@/lib/server/services/userService";
import { useEffect } from "react";

type PropTypes = {
  chats: fetchUserChatsResponse[];
  friends: fetchUserFriendsResponse[];
  friendRequest: fetchUserFriendRequestResponse[];
  user: FetchUserInfoResponse;
  callHistory:fetchUserCallHistoryResponse[];
};

export const usePopulateStateWithServerSideFetchedData = ({
  chats,
  friendRequest,
  friends,
  user,
  callHistory
}: PropTypes) => {
  
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(updateLoggedInUser(user));
    dispatch(setChats(chats));
    dispatch(friendApi.util.upsertQueryData("getFriends", undefined, [...friends]));
    dispatch(requestApi.util.upsertQueryData("getUserFriendRequests", undefined, [...friendRequest]));
    dispatch(setCallHistory(callHistory));

  }, [callHistory, chats, dispatch, friendRequest, friends, user]);
};
