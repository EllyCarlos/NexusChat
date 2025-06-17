import { Event } from "@/interfaces/events.interface";
import { friendApi } from "@/lib/client/rtk-query/friend.api";
import { updateOfflineStatusOfMembersInChats } from "@/lib/client/slices/chatSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { useSocketEvent } from "../useSocket/useSocketEvent";


type OfflineUserEventReceivePayload = {
  userId:string
}

export const useOfflineUserListener = () => {

  const dispatch = useAppDispatch();

  useSocketEvent(Event.OFFLINE_USER, ({userId}:OfflineUserEventReceivePayload) => {

    dispatch(
      friendApi.util.updateQueryData("getFriends", undefined, (draft) => {
        const friend = draft.find((draft) => draft.id === userId);
        if (friend) friend.isOnline = false;
      })
    );

    dispatch(updateOfflineStatusOfMembersInChats({userId}));
  });
};
