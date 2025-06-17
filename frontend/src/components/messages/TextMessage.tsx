"use client";
import { useDecryptMessage } from "@/hooks/useUtils/useDecryptMessage";
import { messageApi } from "@/lib/client/rtk-query/message.api";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { useCallback, useEffect, useState } from "react";
import { EditMessageForm } from "./EditMessageForm";

type PropTypes = {
  cipherText: string;
  messageId: string;
  editMessageId: string | undefined;
  setEditMessageId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setOpenContextMenuMessageId: React.Dispatch<
    React.SetStateAction<string | undefined>
  >;
  loggedInUserId: string;
  selectedChatDetails: fetchUserChatsResponse;
};

export const TextMessage = ({
  cipherText,
  selectedChatDetails,
  messageId,
  editMessageId,
  setEditMessageId,
  setOpenContextMenuMessageId,
  loggedInUserId,
}: PropTypes) => {
  
  const { decryptedMessage } = useDecryptMessage({
    cipherText,
    loggedInUserId,
    selectedChatDetails,
  });

  const dispatch = useAppDispatch();

  const getMessageFromState = useCallback(async()=>{
    dispatch(
      messageApi.util.updateQueryData("getMessagesByChatId",{chatId:selectedChatDetails.id,page:1},(draft)=>{
        const msg = draft.messages.find(draft=>draft.id === messageId);
        if(msg){
          msg.decryptedMessage = decryptedMessage;
        }
      })
    )
  },[decryptedMessage, dispatch, messageId, selectedChatDetails.id]);

  useEffect(()=>{
    if(decryptedMessage){
      getMessageFromState();
    }
  },[decryptedMessage, getMessageFromState])

  const [readMore, setReadMore] = useState<boolean>(false);
  const isMessageLong = decryptedMessage?.length > 500;
  const inEditState = editMessageId === messageId;

  return inEditState ? (
    <EditMessageForm
      messageId={messageId}
      prevContentValue={decryptedMessage}
      setEditMessageId={setEditMessageId}
      setOpenContextMenuMessageId={setOpenContextMenuMessageId}
    />
  ) : (
    <>
      <span className="break-words max-sm:text-sm">
        {readMore ? decryptedMessage : decryptedMessage?.substring(0, 400)}
        {isMessageLong && (
          <span
            className="font-medium cursor-pointer"
            onClick={() => setReadMore(!readMore)}
          >
            {readMore ? " Read less" : " Read more..."}
          </span>
        )}
      </span>
    </>
  );
};
