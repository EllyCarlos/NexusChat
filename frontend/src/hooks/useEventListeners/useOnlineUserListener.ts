import { Event } from "@/interfaces/events.interface";
import { friendApi } from "@/lib/client/rtk-query/friend.api";
import { updateOnlineStatusOfMembersInChats } from "@/lib/client/slices/chatSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { useSocketEvent } from "../useSocket/useSocketEvent";

type OnlineUserEventReceivePayload = {
  userId: string;
}

export const useOnlineUserListener = () => {
  const dispatch = useAppDispatch();

  useSocketEvent(Event.ONLINE_USER, ({userId}:OnlineUserEventReceivePayload) => {

    dispatch(
      friendApi.util.updateQueryData("getFriends", undefined, (draft) => {
        const friend = draft.find(draft => draft.id === userId);
        if (friend)  friend.isOnline = true;
      })
    );

    dispatch(updateOnlineStatusOfMembersInChats({userId}));
  });
};
