import { Event } from "@/interfaces/events.interface";
import { requestApi } from "@/lib/client/rtk-query/request.api";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { fetchUserFriendRequestResponse } from "@/lib/server/services/userService";
import { useSocketEvent } from "../useSocket/useSocketEvent";

export const useFriendRequestListener = () => {
  const dispatch = useAppDispatch();

  useSocketEvent(Event.NEW_FRIEND_REQUEST,(newRequest: fetchUserFriendRequestResponse) => {
      dispatch(
        requestApi.util.updateQueryData("getUserFriendRequests",undefined,(draft) => {
            draft.push(newRequest);
          }
        )
      );
    }
  );
};
