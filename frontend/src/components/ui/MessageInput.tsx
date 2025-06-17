"use client";
import { motion } from "framer-motion";
import { SetStateAction, useCallback, useState } from "react";
import { useDynamicRowValue } from "../../hooks/useUtils/useDynamicRowValue";
import { MessageInputExtraOptions } from "../messages/MessageInputExtraOptions";
import { SendIcon } from "./icons/SendIcon";
import { SmileIcon } from "./icons/SmileIcon";
import { useMessageInputRef } from "@/context/message-input-ref.context";

type PropTypes = {
  messageVal: string;
  setMessageVal: React.Dispatch<React.SetStateAction<string>>;
  setAttachmentsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setEmojiFormOpen: React.Dispatch<SetStateAction<boolean>>;
};

export const MessageInput = ({
  messageVal,
  setMessageVal,
  setAttachmentsMenuOpen,
  setEmojiFormOpen
}: PropTypes) => {
  
  const { getRowValue } = useDynamicRowValue();

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const form = e.currentTarget.closest("form");
      if (form) form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    }
  },[]);

  const [isRecording,setIsRecording] = useState<boolean>(false);
  const [voiceNoteRecorded,setVoiceNoteRecorded] = useState<boolean>(false);

  const ref =  useMessageInputRef();

  return (
    <div className="flex rounded-xl text-text items-center bg-secondary justify-end">

      {
        (!isRecording && !voiceNoteRecorded) && (
          <button className="hover:text-primary" type="button" onClick={()=>setEmojiFormOpen(true)}>
            <SmileIcon />
          </button>
        )
      }

      {
        !voiceNoteRecorded && (
          <textarea
            ref={ref}
            value={messageVal}
            onChange={e => setMessageVal(e.target.value)}
            className="px-3 py-5 bg-secondary outline-none rounded-sm w-full max-sm:text-sm resize-none scroll-smooth"
            aria-autocomplete="none"
            style={{ scrollbarWidth: "none" }}
            autoComplete="off"
            placeholder={isRecording?"Recording ... ":"Your message"}
            name="chatMessageBaatchit"
            inputMode="text"
            id="message-input"
            spellCheck="false"
            autoCorrect="off"
            autoCapitalize="none"
            maxLength={1000}
            rows={getRowValue(messageVal.length)}
            disabled={isRecording || voiceNoteRecorded}
            onKeyDown={handleKeyDown}
          />
        )
      }

      {!messageVal.trim().length && (
        <MessageInputExtraOptions
          isRecording={isRecording}
          setIsRecording={setIsRecording}
          toggleAttachmentsMenu={setAttachmentsMenuOpen}
          voiceNoteRecorded={voiceNoteRecorded}
          setVoiceNoteRecorded={setVoiceNoteRecorded}
        />
      )}

      {messageVal.trim().length>0 && (
        <motion.button
          onMouseDown={(e) => e.preventDefault()}
          initial={{ x: 5, opacity: 0, position: "fixed" }}
          animate={{ x: 0, opacity: 1, position: "static" }}
          type="submit"
          className="bg-primary-dark p-2 hover:bg-transparent transition-colors rounded-full"
        >
          <SendIcon />
        </motion.button>
      )}

    </div>
  );
};
