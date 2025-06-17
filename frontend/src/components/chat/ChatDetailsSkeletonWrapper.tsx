"use client";
import { selectSelectedChatDetails } from "@/lib/client/slices/chatSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { FetchUserInfoResponse } from "@/lib/server/services/userService";
import { ChatDetails } from "./ChatDetails";

type PropTypes = {
  loggedInUser: FetchUserInfoResponse;
};

export const ChatDetailsSkeletonWrapper = ({ loggedInUser }: PropTypes) => {
  const selectedChatDetails = useAppSelector(selectSelectedChatDetails);
  return (
    selectedChatDetails && (
      <ChatDetails
        selectedChatDetails={selectedChatDetails}
        loggedInUser={loggedInUser}
      />
    )
  );
};
