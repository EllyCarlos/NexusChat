"use client";
import { DEFAULT_AVATAR } from "@/constants";
import { useChatHeaderClick } from "@/hooks/useChat/useChatHeaderClick";
import { selectLoggedInUser } from "@/lib/client/slices/authSlice";
import { setCallDisplay } from "@/lib/client/slices/uiSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import Image from "next/image";
import { useCallback } from "react";
import {
  getChatAvatar,
  getOtherMemberOfPrivateChat,
} from "../../lib/shared/helpers";
import { PinMessageArea } from "../pin/PinMessageArea";
import { CallIcon } from "../ui/icons/CallIcon";
import { ChatHeaderBasicInfo } from "./ChatHeaderBasicInfo";
import { ChatHeaderSecondaryInfo } from "./ChatHeaderSecondaryInfo";

type PropTypes = {
  selectedChatDetails: fetchUserChatsResponse;
};

export const ChatHeader = ({ selectedChatDetails }: PropTypes) => {
  const loggedInUserId = useAppSelector(selectLoggedInUser)?.id as string;

  const otherMemberOfPrivateChat = getOtherMemberOfPrivateChat(
    selectedChatDetails,
    loggedInUserId
  ).user;

  const { handleChatHeaderClick } = useChatHeaderClick();

  const chatAvatar = getChatAvatar(
    selectedChatDetails,
    loggedInUserId
  ) as string;

  const dispatch = useAppDispatch();

  const handleCallClick = useCallback(()=>{
    dispatch(setCallDisplay(true));
  },[dispatch])

  return (
    <div className="flex flex-col gap-1">
      <div
        onClick={handleChatHeaderClick}
        className="flex items-center justify-between text-text"
      >
        <div className="flex gap-x-3">
          <Image
            className="w-14 h-14 rounded-full max-sm:w-10 max-sm:h-10 object-cover"
            src={chatAvatar || DEFAULT_AVATAR}
            alt={"chat-avatar"}
            width={200}
            height={200}
          />
          <div className="flex flex-col gap-y-1 max-sm:gap-y-[.5px]">
            <ChatHeaderBasicInfo
              loggedInUserId={loggedInUserId}
              otherMemberOfPrivateChat={otherMemberOfPrivateChat}
              selectedChatDetails={selectedChatDetails}
            />
            <ChatHeaderSecondaryInfo
              otherMemberOfPrivateChat={otherMemberOfPrivateChat}
              selectedChatDetails={selectedChatDetails}
              loggedInUserId={loggedInUserId}
            />
          </div>
        </div>

        {
          !selectedChatDetails.isGroupChat && (
            <span onClick={handleCallClick} className="cursor-pointer"><CallIcon/></span>
          )
        }
      </div>
      {
        selectedChatDetails.PinnedMessages.length > 0 && (
          <PinMessageArea selectedChatDetails={selectedChatDetails}/>
        )
      }
    </div>
  );
};
