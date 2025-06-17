import { Event } from "@/interfaces/events.interface";
import { friendApi } from "@/lib/client/rtk-query/friend.api";
import { selectLoggedInUser } from "@/lib/client/slices/authSlice";
import { addNewChat } from "@/lib/client/slices/chatSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { fetchUserChatsResponse, fetchUserFriendsResponse } from "@/lib/server/services/userService";
import { getOtherMemberOfPrivateChat } from "@/lib/shared/helpers";
import { useSocketEvent } from "../useSocket/useSocketEvent";

export const useNewChatListener = () => {
  const dispatch = useAppDispatch();
  const loggedInUserId = useAppSelector(selectLoggedInUser)?.id;

  useSocketEvent(Event.NEW_CHAT, (newChat: fetchUserChatsResponse) => {
    console.log('new chat',newChat);

    if (loggedInUserId && !newChat.isGroupChat) {
      const member = getOtherMemberOfPrivateChat(newChat, loggedInUserId).user;

      if (member) {
        dispatch(
          friendApi.util.updateQueryData("getFriends", undefined, (draft) => {
            const newFriend: fetchUserFriendsResponse = {
              avatar: member.avatar,
              createdAt: new Date(),
              id: member.id,
              isOnline: member.isOnline,
              lastSeen: member.lastSeen,
              publicKey: member.publicKey,
              username: member.username,
              verificationBadge: member.verificationBadge,
            };

            draft.push(newFriend);
          })
        );
      }
    }

    dispatch(addNewChat({newChat}));
  });
};
