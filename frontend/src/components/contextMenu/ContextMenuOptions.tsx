import { useMessageInputRef } from "@/context/message-input-ref.context";
import { useSocket } from "@/context/socket.context";
import { Event } from "@/interfaces/events.interface";
import { useGetMessagesByChatIdQuery } from "@/lib/client/rtk-query/message.api";
import { selectSelectedChatDetails } from "@/lib/client/slices/chatSlice";
import { setReplyingToMessageData, setReplyingToMessageId } from "@/lib/client/slices/uiSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { MouseEvent, useCallback } from "react";
import { CopyIcon } from "../ui/icons/CopyIcon";
import { DeleteIcon } from "../ui/icons/DeleteIcon";
import { EditIcon } from "../ui/icons/EditIcon";
import { ReplyIcon } from "../ui/icons/ReplyIcon";
import { PinIcon } from "../ui/icons/PinIcon";
import toast from "react-hot-toast";

type PropTypes = {
  setOpenContextMenuMessageId: React.Dispatch<
    React.SetStateAction<string | undefined>
  >;
  setEditMessageId: React.Dispatch<React.SetStateAction<string | undefined>>;
  messageId: string;
  isTextMessage:boolean;
  isAttachmentMessage:boolean;
  myMessage: boolean;
};

type MessageDeleteEventSendPayload = {
  chatId:string
  messageId:string
}

type PinMessageEventSendPayload = {
  chatId:string
  messageId:string
}

type UnpinMessageEventSendPayload = {
  pinId:string
}

export const ContextMenuOptions = ({
  setEditMessageId,
  setOpenContextMenuMessageId,
  messageId,
  isTextMessage,
  isAttachmentMessage,
  myMessage, 
}: PropTypes) => {


  const dispatch = useAppDispatch();
  const ref =  useMessageInputRef();
  const selectedChatDetails =  useAppSelector(selectSelectedChatDetails) as fetchUserChatsResponse;
  const socket = useSocket();

  const { message } = useGetMessagesByChatIdQuery({chatId:selectedChatDetails.id,page:1},{
    selectFromResult:({data})=>({
      message: data?.messages.find(msg=>msg.id === messageId)
    })
  })
  
  const handleReplyClick = useCallback(()=>{
    if(ref && ref.current){
      ref.current.focus();
      dispatch(setReplyingToMessageData((message?.attachments && message.attachments.length > 0) ? "Replying to Attachment" : message?.isTextMessage ? `Replying to "${(message?.decryptedMessage as string).length > 100 ? (message?.decryptedMessage as string).substring(0,100)+"...":(message?.decryptedMessage as string).substring(0,100)}"` : message?.audioUrl ? " Replying to Voice Note" : message?.isPollMessage ? "Replying to Poll" : message?.url ? 'Replying to Gif' : "n/a"));
      dispatch(setReplyingToMessageId(messageId));
      setOpenContextMenuMessageId(undefined)
    }
  },[dispatch, message?.audioUrl, message?.decryptedMessage, message?.isPollMessage, message?.isTextMessage, message?.url, messageId, ref, setOpenContextMenuMessageId])


  const deleteMessage = useCallback(()=>{
    setOpenContextMenuMessageId(undefined)
    const payload:MessageDeleteEventSendPayload = {
      chatId:selectedChatDetails.id,
      messageId
    }
    socket?.emit(Event.MESSAGE_DELETE,payload);
  },[messageId, selectedChatDetails.id, setOpenContextMenuMessageId, socket]);

  const handleCopyClick = useCallback(async()=>{
    try {
      await navigator.clipboard.writeText(message?.decryptedMessage as string);
      setOpenContextMenuMessageId(undefined);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  },[message?.decryptedMessage, setOpenContextMenuMessageId])

  const handlePinClick = useCallback((e:MouseEvent<HTMLDivElement, globalThis.MouseEvent>)=>{
    e.stopPropagation();
    const payload:PinMessageEventSendPayload = {
      chatId:selectedChatDetails.id,
      messageId
    }
    socket?.emit(Event.PIN_MESSAGE,payload);
    setOpenContextMenuMessageId(undefined);
  },[messageId, selectedChatDetails.id, setOpenContextMenuMessageId, socket]);

  const handleUnpinClick = useCallback((e:MouseEvent<HTMLDivElement, globalThis.MouseEvent>)=>{
      e.stopPropagation();

      const pinId = selectedChatDetails.PinnedMessages.find(pin=>pin.message.id === messageId)?.id;

      if(!pinId){
        toast.error("Some error occurred while unpinning the message");
        return;
      }
      const payload:UnpinMessageEventSendPayload = {
          pinId
      }
      socket?.emit(Event.UNPIN_MESSAGE,payload);
      setOpenContextMenuMessageId(undefined);
  },[messageId, selectedChatDetails.PinnedMessages, setOpenContextMenuMessageId, socket]);

  return (
    <div className={`flex flex-col bg-secondary-dark text-text p-2 rounded-2xl shadow-2xl min-w-32 self-end`}>
      <div className="flex flex-col">
        {
          (myMessage && (isTextMessage || isAttachmentMessage)) &&
          <div
            onClick={() => {
              setOpenContextMenuMessageId(undefined);
              setEditMessageId(messageId);
            }}
            className="cursor-pointer p-2 rounded-sm hover:bg-secondary-darker flex items-center justify-between"
          >
            <p>{isAttachmentMessage ? "Caption" : "Edit"}</p>
            <span>
              <EditIcon />
            </span>
          </div>
        }
        <div
            onClick={handleReplyClick}
            className="cursor-pointer p-2 rounded-sm hover:bg-secondary-darker flex items-center justify-between"
          >
            <span>Reply</span>
            <span>
              <ReplyIcon/>
            </span>
        </div>
          {
            myMessage && (
              <div
                onClick={deleteMessage}
                className="cursor-pointer p-2 rounded-sm hover:bg-secondary-darker flex items-center justify-between"
              >
                <p>Unsend</p>
                <span>
                  <DeleteIcon/>
                </span>
              </div>
            )
          }
          {
            message?.decryptedMessage && (
            <div
                  onClick={handleCopyClick}
                  className="cursor-pointer p-2 rounded-sm hover:bg-secondary-darker flex items-center justify-between"
                >
                  <p>Copy</p>
                  <span>
                    <CopyIcon/>
                  </span>
            </div>
            )
          }
          {
            myMessage && (
            <div
                  onClick={message?.isPinned?handleUnpinClick:handlePinClick}
                  className="cursor-pointer p-2 rounded-sm hover:bg-secondary-darker flex items-center justify-between"
                >
                  <p>{message?.isPinned ? "Unpin" : "Pin"}</p>
                  <span>
                    <PinIcon/>
                  </span>
            </div>
            )
          }
      </div>
    </div>
  );
};
