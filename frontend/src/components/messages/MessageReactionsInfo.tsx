import { Message } from "@/interfaces/message.interface";
import { fetchUserChatsResponse } from "@/lib/server/services/userService";
import { motion } from "framer-motion";
import { MessageReactionList } from "./MessageReactionList";
import { useHandleOutsideClick } from "@/hooks/useUtils/useHandleOutsideClick";
import { useRef } from "react";

type PropTypes = {
  message: Message;
  loggedInUserId: string;
  selectedChatDetails: fetchUserChatsResponse;
  setReactionMenuMessageId: React.Dispatch<
  React.SetStateAction<string | undefined>
>;
};

export const MessageReactionsInfo = ({
  loggedInUserId,
  message,
  selectedChatDetails,
  setReactionMenuMessageId,
}: PropTypes) => {

  const myMessage = loggedInUserId === message.sender.id;

  const reactionsRef = useRef<HTMLDivElement>(null);
  useHandleOutsideClick(reactionsRef, () => setReactionMenuMessageId(undefined));

  return (
    <motion.div
      ref={reactionsRef}
      variants={{ hide: { opacity: 0, y: 5 }, show: { opacity: 1, y: 0 } }}
      initial="hide"
      animate="show"
      className={`absolute bg-secondary-dark min-w-72 ${
        myMessage ? "right-0" : "left-0"
      } max-h-72 min-h-56  top-0 overflow-y-auto scroll-smooth p-4 rounded-md flex flex-col gap-y-4 z-10`}
    >
      <h4 className="text-lg">Reactions</h4>
      <MessageReactionList
        loggedInUserId={loggedInUserId}
        messageId={message.id}
        reactions={message.reactions}
        selectedChatDetails={selectedChatDetails}
      />
    </motion.div>
  );
};
