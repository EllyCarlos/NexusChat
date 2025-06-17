import { Message } from "@/interfaces/message.interface";
import { EmojiClickData } from "emoji-picker-react";
import { useDeleteReaction } from "./useDeleteReaction";
import { useSendNewReaction } from "./useSendNewReaction";

type PropTypes = {
  message: Message;
  chatId: string;
  messageId: string;
  loggedInUserId: string;
  setOpenContextMenuMessageId: React.Dispatch<
    React.SetStateAction<string | undefined>
  >;
};

export const useEmojiClickReactionFeature = ({
  message,
  setOpenContextMenuMessageId,
  chatId,
  messageId,
  loggedInUserId,
}: PropTypes) => {

  const { sendNewReaction } = useSendNewReaction();
  const { deleteReaction } = useDeleteReaction();

  const handleEmojiClick = (e: EmojiClickData) => {
    if (message.reactions?.length > 0 && message.reactions.find(reaction => reaction.user.id === loggedInUserId)) {
      // if an old reaction exists then delete it first
      deleteReaction({ chatId, messageId });
    }
    setTimeout(() => {
      sendNewReaction({ chatId, messageId, reaction: e.emoji });
    }, 100);
    setOpenContextMenuMessageId(undefined);
  };

  return { handleEmojiClick };
};
