"use client";
import { useFetchMessagesOnPageChange } from "@/hooks/useMessages/useFetchMessagesOnPageChange";
import { useGetMessages } from "@/hooks/useMessages/useGetMessages";
import { useHandleScroll } from "@/hooks/useMessages/useHandleScroll";
import { useRestoreUserScrollPosition } from "@/hooks/useMessages/useRestoreUserScrollPosition";
import { useScrollToBottomOnChatSelect } from "@/hooks/useMessages/useScrollToBottomOnChatSelect";
import { useScrollToBottomOnNewMessageWhenUserIsNearBottom } from "@/hooks/useMessages/useScrollToBottomOnNewMessageWhenUserIsNearBottom";
import { useScrollToBottomOnTypingWhenUserIsNearBottom } from "@/hooks/useMessages/useScrollToBottomOnTypingWhenUserIsNearBottom";
import { useSetHasMoreMessagesBasedOnTotalPages } from "@/hooks/useMessages/useSetHasMoreMessagesBasedOnTotalPages";
import { useSetPageToOneOnChatChange } from "@/hooks/useMessages/useSetPageToOneOnChatChange";
import { Message } from "@/interfaces/message.interface";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { useRef, useState } from "react";
import { CircleLoading } from "../shared/CircleLoading";
import { MessageListItem } from "./MessageListItem";
import { TypingIndicator } from "./TypingIndicator";

type PropTypes = {
  messages: Message[];
  selectedChatDetails: fetchUserChatsResponse;
  totalPages: number;
  loggedInUserId: string;
};

export const MessageList = ({messages,selectedChatDetails,totalPages,loggedInUserId}: PropTypes) => {
  
  const [editMessageId, setEditMessageId] = useState<string>();
  const [openContextMenuMessageId, setOpenContextMenuMessageId] = useState<string>();
  const [reactionMenuMessageId, setReactionMenuMessageId] = useState<string | undefined>();
  
  const [page, setPage] = useState<number>(1);
  const [hasMoreMessages, setHasMoreMessages] = useState<boolean>(true);
  const [isNearBottom, setIsNearBottom] = useState<boolean>(true);

  const prevHeightRef = useRef<number>(0);
  const prevScrollTopRef = useRef<number>(0);

  const {isFetching: IsFetchingMessages,getMessages} = useGetMessages();
  const messageContainerRef = useRef<HTMLDivElement>(null);

  const getPreviousMessages = ({chatId,page}:{chatId:string,page:number}) => {
    getMessages({chatId,page})
  }

  useSetPageToOneOnChatChange({setPage});
  useScrollToBottomOnChatSelect({messageContainerRef});
  useSetHasMoreMessagesBasedOnTotalPages({ setHasMoreMessages, totalPages });

  const {handleScroll} = useHandleScroll({
    container:messageContainerRef,
    hasMoreMessages,
    IsFetchingMessages,
    prevHeightRef,
    prevScrollTopRef,
    setIsNearBottom,
    setPage,
  });
  useFetchMessagesOnPageChange({
    page,
    hasMoreMessages,
    isFetching:IsFetchingMessages,
    getPreviousMessages,
    totalPages,
    setHasMoreMessages,
  });
  useRestoreUserScrollPosition({
    container:messageContainerRef,
    IsFetchingMessages,
    page,
    prevHeightRef,
    prevScrollTopRef,
  });
  useScrollToBottomOnNewMessageWhenUserIsNearBottom({
    container:messageContainerRef,
    isNearBottom,
    messages,
    prevHeightRef,
    prevScrollTopRef,
  });
  useScrollToBottomOnTypingWhenUserIsNearBottom({
    container:messageContainerRef,
    isNearBottom,
  });


  return (
    <>
      {/* <span className="text-white">{`total page - ${totalPages}  |  page - ${page}  |  isNearBottom - ${isNearBottom}`}</span> */}
      <div
        ref={messageContainerRef}
        onScroll={handleScroll}
        className="relative flex h-full flex-col gap-y-4 max-xl:gap-y-2 overflow-y-auto overflow-x-hidden"
      >
        {IsFetchingMessages && <CircleLoading/>}
        {messages.map((message) => (
          <MessageListItem
            key={`${message.id}-${message.isEdited}`}
            openContextMenuMessageId={openContextMenuMessageId}
            selectedChatDetails={selectedChatDetails}
            loggedInUserId={loggedInUserId}
            setOpenContextMenuMessageId={setOpenContextMenuMessageId}
            editMessageId={editMessageId}
            setEditMessageId={setEditMessageId}
            message={message}
            reactionMenuMessageId={reactionMenuMessageId}
            setReactionMenuMessageId={setReactionMenuMessageId}
          />
        ))}
        {isNearBottom && <TypingIndicator selectedChatDetails={selectedChatDetails}/>}
      </div>
    </>
  );
};
