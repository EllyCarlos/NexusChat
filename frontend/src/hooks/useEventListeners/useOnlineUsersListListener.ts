import { Event } from "@/interfaces/events.interface";
import { friendApi } from "@/lib/client/rtk-query/friend.api";
import { updateMembersActiveStatusInChats } from "@/lib/client/slices/chatSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { useSocketEvent } from "../useSocket/useSocketEvent";

type OnlineUsersListEventReceivePayload = {
  onlineUserIds:string[]
}

export const useOnlineUsersListListener = () => {

  const dispatch = useAppDispatch();

  useSocketEvent(Event.ONLINE_USERS_LIST, ({onlineUserIds}:OnlineUsersListEventReceivePayload) => {

    dispatch(
      friendApi.util.updateQueryData("getFriends", undefined, (draft) => {
        draft.forEach(friend => {
          friend.isOnline = onlineUserIds.includes(friend.id);
        });
      })
    );

    dispatch(updateMembersActiveStatusInChats(onlineUserIds));
  });
};
