import { Event } from "@/interfaces/events.interface";
import { selectLoggedInUser } from "@/lib/client/slices/authSlice";
import { updateUnreadMessagesAsSeen } from "@/lib/client/slices/chatSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { useSocketEvent } from "../useSocket/useSocketEvent";

type MessageSeenEventReceivePayload = {
  user:{
      id:string
      username:string
      avatar:string
  },
  chatId:string,
  readAt:Date
}


export const useMessageSeenListener = () => {

  const dispatch = useAppDispatch();
  const loggedInUserId = useAppSelector(selectLoggedInUser)?.id;

  useSocketEvent(Event.MESSAGE_SEEN,({chatId,user}: MessageSeenEventReceivePayload) => {
    dispatch(updateUnreadMessagesAsSeen({chatId,userId:user.id,loggedInUserId:loggedInUserId!}));
  }
  );
};
