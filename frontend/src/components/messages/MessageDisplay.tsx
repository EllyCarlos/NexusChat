import { useDoubleClickReactionFeature } from "@/hooks/useMessages/useDoubleClickReactionFeature";
import { Message } from "@/interfaces/message.interface";
import { useGetMessagesByChatIdQuery } from "@/lib/client/rtk-query/message.api";
import { selectReplyingToMessageId } from "@/lib/client/slices/uiSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { Dispatch, SetStateAction } from "react";
import { RenderAppropriateMessage } from "./RenderAppropriateMessage";
import Image from "next/image";
import { PinIcon } from "../ui/icons/PinIcon";

type PropTypes = {
  isContextMenuOpen: boolean;
  myMessage: boolean;
  editMessageId: string | undefined;
  loggedInUserId: string;
  selectedChatDetails: fetchUserChatsResponse;
  message: Message;
  setEditMessageId: Dispatch<SetStateAction<string | undefined>>;
  setOpenContextMenuMessageId: Dispatch<SetStateAction<string | undefined>>;
};

export const MessageDisplay = ({
  isContextMenuOpen,
  myMessage,
  editMessageId,
  loggedInUserId,
  selectedChatDetails,
  message,
  setEditMessageId,
  setOpenContextMenuMessageId,
}: PropTypes) => {
  const { handleDoubleClick } = useDoubleClickReactionFeature({
    chatId: selectedChatDetails.id,
    loggedInUserId,
    messageId: message.id,
    reactions: message.reactions,
  });

  const replyMessageId =  useAppSelector(selectReplyingToMessageId);

  const { messageWeRepliedTo } = useGetMessagesByChatIdQuery({chatId:selectedChatDetails.id,page:1},{
    selectFromResult:({data})=>({
      messageWeRepliedTo: data?.messages.find(msg=>msg.id === message?.replyToMessage?.id)
    })
  })

  return (
    <motion.div
      whileTap={{ scale: message.isPollMessage ? 1 : 0.98 }}
      onDoubleClick={handleDoubleClick}
      className={`${myMessage ? "bg-primary text-white" : "bg-secondary-dark"} ${isContextMenuOpen? "border-2 border-double border-spacing-4 border-": null} max-w-96 min-w-20 rounded-2xl px-4 py-2 flex flex-col gap-y-1 justify-center max-md:max-w-80 max-sm:max-w-64
      ${replyMessageId === message.id ? `border-2 border-double border-spacing-4 ${myMessage?"white":"border-primary"}` : null}
      `}
    >
      {
        message.replyToMessage && (
        <div className="flex flex-col bg-white/35 px-4 py-2 mb-2 rounded-xl max-sm:text-sm">
          <span className="text-sm font-semibold">{message.replyToMessage.sender.id === loggedInUserId ? "You" : message.replyToMessage.sender.username}</span>
          <div>{message.replyToMessage.attachments.length ? "attachment" : message.replyToMessage.audioUrl ? 'Voice note' : message.replyToMessage.isPollMessage ? 'Poll' : message.replyToMessage.textMessageContent ? messageWeRepliedTo?.decryptedMessage || 'deleted' : message.replyToMessage.url ? 
            <Image unoptimized className="size-10 object-contain" width={10} height={10} src={message.replyToMessage.url} alt="gif" />
           : "n/a"}</div>
        </div>
        )
      }
      <RenderAppropriateMessage
        editMessageId={editMessageId}
        loggedInUserId={loggedInUserId}
        selectedChatDetails={selectedChatDetails}
        message={message}
        setEditMessageId={setEditMessageId}
        setOpenContextMenuMessageId={setOpenContextMenuMessageId}
      />
      <div className="flex items-center ml-auto gap-2 flex-nowrap shrink-0">
        {message.isEdited && 
          <span className="text-secondary font-medim text-sm max-sm:text-xs">
            Edited
          </span>
        }
        {
          message.isPinned && (
            <span>
              <PinIcon size={4}/>
            </span>
          )
        }
        <span className={`text-xs ${myMessage ? "text-gray-200" : "text-secondary-darker"}`}>
          {format(message.createdAt, "h:mm a").toLowerCase()}
        </span>
      </div>
    </motion.div>
  );
};
