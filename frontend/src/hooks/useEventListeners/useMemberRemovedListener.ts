import { Event } from "@/interfaces/events.interface";
import {
  removeChatMembers,
  removeSelectedChatMembers,
  selectSelectedChatDetails,
} from "@/lib/client/slices/chatSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { useEffect, useRef } from "react";
import { useSocketEvent } from "../useSocket/useSocketEvent";

type MemberRemovedEventReceivePayload = {
  chatId: string;
  membersId: string[];
}

export const useMemberRemovedListener = () => {

  const dispatch = useAppDispatch();
  const selectedChatDetails = useAppSelector(selectSelectedChatDetails);

  const selectedChatDetailsRef = useRef(selectedChatDetails);

  useEffect(() => {
    selectedChatDetailsRef.current = selectedChatDetails;
  }, [selectedChatDetails]);

  useSocketEvent(Event.MEMBER_REMOVED,({chatId,membersId}:MemberRemovedEventReceivePayload) => {

      const isMemberRemovedFromSelectedChatId = selectedChatDetailsRef.current?.id === chatId;

      dispatch(removeChatMembers({chatId,membersIds:membersId}));

      if (isMemberRemovedFromSelectedChatId) dispatch(removeSelectedChatMembers(membersId));

    }
  );
};
