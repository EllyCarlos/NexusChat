"use client";
import { useGenerateAttachmentsPreview } from "@/hooks/useAttachment/useGenerateAttachmentsPreview";
import { useHandleUploadAttachment } from "@/hooks/useAttachment/useHandleUploadAttachment";
import { useHandleSendMessage } from "@/hooks/useMessages/useHandleSendMessage";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useState } from "react";
import { useEmitTypingEvent } from "../../hooks/useChat/useEmitTypingEvent";
import { useDebounce } from "../../hooks/useUtils/useDebounce";
import { AttachmentMenu } from "../attachments/AttachmentMenu";
import { SelectedAttachmentsPreviewList } from "../attachments/SelectedAttachmentsPreviewList";
import { EmojiSelector } from "../messages/EmojiSelector";
import { MessageInput } from "../ui/MessageInput";
import { UploadIcon } from "../ui/icons/UploadIcon";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { selectReplyingToMessageData, setReplyingToMessageData, setReplyingToMessageId } from "@/lib/client/slices/uiSlice";
import { CrossIcon } from "../ui/icons/CrossIcon";

type PropTypes = {
  selectedChatDetails: fetchUserChatsResponse;
};
export const MessageInputArea = ({ selectedChatDetails }: PropTypes) => {
  
  const [selectedAttachments, setSelectedAttachments] = useState<Blob[]>([]);
  const { attachmentsPreview } = useGenerateAttachmentsPreview({selectedAttachments});

  const [attachmentsMenuOpen, setAttachmentsMenuOpen] = useState<boolean>(false);
  const [emojiFormOpen, setEmojiFormOpen] = useState<boolean>(false);

  const [messageVal, setMessageVal] = useState<string>("");

  const dispatch = useAppDispatch();

  const isTyping = useDebounce(messageVal, 200);
  useEmitTypingEvent(isTyping);

  const { handleMessageSubmit } = useHandleSendMessage({
    messageVal,
    setMessageVal,
  });

  const {handleUploadAttachments} = useHandleUploadAttachment({selectedAttachments,selectedChatDetails,setSelectedAttachments});

  const replyingToMessageData = useAppSelector(selectReplyingToMessageData);

  const handleReplyCancelClick = useCallback(()=>{
    dispatch(setReplyingToMessageData(null));
    dispatch(setReplyingToMessageId(null));
  },[dispatch])

  return (
    <form
      onSubmit={handleMessageSubmit}
      className="relative"
      autoComplete="off"
    >


      {attachmentsPreview.length > 0 && (
        <div className="flex items-center flex-wrap gap-4 ml-auto w-fit">
            <SelectedAttachmentsPreviewList
              attachmentsPreview={attachmentsPreview}
              selectedAttachments={selectedAttachments}
              setSelectedAttachments={setSelectedAttachments}
            />
          <motion.button
            type="button"
            onClick={handleUploadAttachments}
            className="p-4 bg-primary text-white rounded-full shadow-xl"
          >
            <UploadIcon/>
          </motion.button>
        </div>
      )}

      <AnimatePresence>
        {attachmentsMenuOpen && (
          <AttachmentMenu
            setAttachmentsMenuOpen={setAttachmentsMenuOpen}
            setSelectedAttachments={setSelectedAttachments}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {emojiFormOpen && (
          <EmojiSelector
            setEmojiFormOpen={setEmojiFormOpen}
            setMessageVal={setMessageVal}
          />
        )}
      </AnimatePresence>
      

        {
          replyingToMessageData && (
            <motion.div initial={{y:5,opacity:0}} animate={{y:0,opacity:1}} exit={{y:5,opacity:0}} className="bg-secondary-dark max-sm:text-sm px-2 py-2 rounded-md flex justify-between items-center">
              <p className="text-text px-2">{replyingToMessageData}</p>
              <button onClick={handleReplyCancelClick} type="button" className="text-text">
                <CrossIcon size={5}/>
              </button>
            </motion.div>
          )
        }


      <MessageInput
        messageVal={messageVal}
        setMessageVal={setMessageVal}
        setAttachmentsMenuOpen={setAttachmentsMenuOpen}
        setEmojiFormOpen={setEmojiFormOpen}
      />
    </form>
  );
};
