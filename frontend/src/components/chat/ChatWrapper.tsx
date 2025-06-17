"use client";

import { useCheckUserPrivateKeyInIndexedDB } from "@/hooks/useAuth/useCheckUserPrivateKeyInIndexedDB";
import { useFetchAuthToken } from "@/hooks/useAuth/useFetchAuthToken";
import { useUpdateUnreadMessagesAsSeenOnChatSelect } from "@/hooks/useChat/useUpdateUnreadChatAsSeen";
import useFcmToken from "@/hooks/useFcm/useFcmToken";
import { useStoreFcmTokenInDb } from "@/hooks/useFcm/useStoreFcmTokenInDb";
import { useClearExtraPreviousMessagesOnChatChange } from "@/hooks/useMessages/useClearExtraPreviousMessagesOnChatChange";
import { useAttachEventListeners } from "@/hooks/useUtils/useAttachEventListeners";
import { usePopulateStateWithServerSideFetchedData } from "@/hooks/useUtils/usePopulateStateWithServerSideFetchedData";
import { fetchUserCallHistoryResponse } from "@/lib/server/services/callService";
import { fetchUserChatsResponse, fetchUserFriendRequestResponse, fetchUserFriendsResponse, FetchUserInfoResponse } from "@/lib/server/services/userService";


type PropTypes = {
  children: React.ReactNode;
  user: FetchUserInfoResponse;
  friends: fetchUserFriendsResponse[];
  chats: fetchUserChatsResponse[];
  friendRequest: fetchUserFriendRequestResponse[];
  callHistory:fetchUserCallHistoryResponse[];
};

export const ChatWrapper = ({children,chats,friendRequest,friends,user,callHistory}: PropTypes) => {

  // client side state hydration
  usePopulateStateWithServerSideFetchedData({chats,friendRequest,friends,user,callHistory});

  // chats
  useUpdateUnreadMessagesAsSeenOnChatSelect();

  // all socket event listners
  useAttachEventListeners();

  // security
  useCheckUserPrivateKeyInIndexedDB({loggedInUser:user});

  // messages
  useClearExtraPreviousMessagesOnChatChange();

  // fetch the auth token and set in state
  // so that rtk query can this token to make requests to backend
  useFetchAuthToken();

  const {token} = useFcmToken();
  
  useStoreFcmTokenInDb({generatedFcmToken:token,userFcmToken:user.fcmToken,loggedInUserId:user.id})

  return children;
};
