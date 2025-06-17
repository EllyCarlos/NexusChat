import { useCloseReactionsMenuWhenZeroReactions } from "@/hooks/useMessages/useCloseReactionsMenuWhenZeroReactions";
import { useEmojiClickReactionFeature } from "@/hooks/useMessages/useEmojiClickReactionFeature";
import { useHandleContextMenuClick } from "@/hooks/useMessages/useHandleContextMenuClick";
import { useHandleOutsideClick } from "@/hooks/useUtils/useHandleOutsideClick";
import type { Message } from "@/interfaces/message.interface";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { motion } from "framer-motion";
import Image from "next/image";
import { useRef } from "react";
import { ContextMenu } from "../contextMenu/ContextMenu";
import { MessageDisplay } from "./MessageDisplay";
import { MessageReactions } from "./MessageReactions";
import { MessageReactionsInfo } from "./MessageReactionsInfo";

type PropTypes = {
  editMessageId: string | undefined;
  message: Message;
  loggedInUserId: string;
  selectedChatDetails: fetchUserChatsResponse;
  reactionMenuMessageId: string | undefined;
  openContextMenuMessageId: string | undefined;
  setEditMessageId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setOpenContextMenuMessageId: React.Dispatch<
    React.SetStateAction<string | undefined>
  >;
  setReactionMenuMessageId: React.Dispatch<
    React.SetStateAction<string | undefined>
  >;
};

export const MessageListItem = ({
  message,
  openContextMenuMessageId,
  reactionMenuMessageId,
  selectedChatDetails,
  loggedInUserId,
  editMessageId,
  setReactionMenuMessageId,
  setOpenContextMenuMessageId,
  setEditMessageId,
}: PropTypes) => {

  const reactionsRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useHandleOutsideClick(reactionsRef, () =>
    setReactionMenuMessageId(undefined)
  );
  useHandleOutsideClick(contextMenuRef, () =>
    setOpenContextMenuMessageId(undefined)
  );

  useCloseReactionsMenuWhenZeroReactions({ message, setReactionMenuMessageId });

  const { handleContextMenuClick } = useHandleContextMenuClick({
    messageId: message.id,
    openContextMenuMessageId,
    setOpenContextMenuMessageId,
  });

  const { handleEmojiClick } = useEmojiClickReactionFeature({
    chatId: selectedChatDetails.id,
    loggedInUserId,
    messageId: message.id,
    message,
    setOpenContextMenuMessageId,
  });

  const myMessage = message.sender.id === loggedInUserId;
  const isContextMenuOpen = openContextMenuMessageId === message.id;
  const isReactionMenuOpen = reactionMenuMessageId === message.id;
  const messageHasReactions = message.reactions.length > 0;

  return (
    <motion.div
      initial={{ x: -2 }}
      animate={{ x: 0 }}
      className={`flex gap-x-2 ${
        myMessage ? "self-end" : ""
      } text-text relative `}
      onContextMenu={(e) => handleContextMenuClick(e)}
    >
      {isContextMenuOpen && (
        <ContextMenu
          messageId={message.id}
          setEditMessageId={setEditMessageId}
          setOpenContextMenuMessageId={setOpenContextMenuMessageId}
          onEmojiClick={handleEmojiClick}
          myMessage={message.sender.id === loggedInUserId}
          isTextMessage={message.isTextMessage}
          isAttachmentMessage={message.attachments.length > 0}
        />
      )}
      
      {!myMessage && (
        <Image
          className="aspect-square object-cover w-12 self-end rounded-full max-lg:w-10 max-sm:w-8"
          src={message.sender.avatar}
          alt={`${message.sender.username}-profile-pic`}
          width={100}
          height={100}
        />
      )}

      <div className="flex flex-col">
        <MessageDisplay
          editMessageId={editMessageId}
          isContextMenuOpen={isContextMenuOpen}
          loggedInUserId={loggedInUserId}
          message={message}
          myMessage={myMessage}
          selectedChatDetails={selectedChatDetails}
          setEditMessageId={setEditMessageId}
          setOpenContextMenuMessageId={setOpenContextMenuMessageId}
        />

        {messageHasReactions && (
          <MessageReactions
            message={message}
            setReactionMenuMessageId={setReactionMenuMessageId}
          />
        )}

        {isReactionMenuOpen && messageHasReactions && (
          <MessageReactionsInfo
            loggedInUserId={loggedInUserId}
            message={message}
            selectedChatDetails={selectedChatDetails}
            setReactionMenuMessageId={setReactionMenuMessageId}
          />
        )}
      </div>
    </motion.div>
  );
};
