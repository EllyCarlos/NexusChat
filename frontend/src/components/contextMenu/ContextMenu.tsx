import { useHandleOutsideClick } from "@/hooks/useUtils/useHandleOutsideClick";
import { EmojiClickData } from "emoji-picker-react";
import { motion } from "framer-motion";
import { useRef } from "react";
import { EmojiPickerForm } from "../emoji/EmojiPickerForm";
import { ContextMenuOptions } from "./ContextMenuOptions";

type PropTypes = {
  onEmojiClick: (e: EmojiClickData) => void | null;
  setOpenContextMenuMessageId: React.Dispatch<
    React.SetStateAction<string | undefined>
  >;
  setEditMessageId: React.Dispatch<React.SetStateAction<string | undefined>>;
  messageId: string;
  myMessage: boolean;
  isTextMessage:boolean;
  isAttachmentMessage:boolean;
};

export const ContextMenu = ({
  setOpenContextMenuMessageId,
  setEditMessageId,
  onEmojiClick,
  messageId,
  myMessage,
  isTextMessage,
  isAttachmentMessage,

}: PropTypes) => {

  const contextRef = useRef<HTMLDivElement>(null);

  useHandleOutsideClick(contextRef,()=>setOpenContextMenuMessageId(undefined));


  return (
    <motion.div
     ref={contextRef}
      variants={{ hide: { opacity: 0 }, show: { opacity: 1 } }}
      initial="hide"
      animate="show"
      className={`flex flex-col gap-y-2 absolute ${
        myMessage ? "right-0" : "left-0"
      } z-10`}
    >
      <EmojiPickerForm
        onEmojiClick={onEmojiClick}
        reactionsDefaultOpen={true}
      />
      
      <ContextMenuOptions
        messageId={messageId}
        setEditMessageId={setEditMessageId}
        setOpenContextMenuMessageId={setOpenContextMenuMessageId}
        isTextMessage={isTextMessage}
        isAttachmentMessage={isAttachmentMessage}
        myMessage={myMessage}
      />
    </motion.div>
    
  );
};
