import { Message } from "@/interfaces/message.interface";
import { useDeleteReaction } from "./useDeleteReaction";
import { useSendNewReaction } from "./useSendNewReaction";

type PropTypes = {
  chatId: string;
  messageId: string;
  reactions: Message["reactions"];
  loggedInUserId: string;
};

export const useDoubleClickReactionFeature = ({
  chatId,
  loggedInUserId,
  messageId,
  reactions,
}: PropTypes) => {
  const { deleteReaction } = useDeleteReaction();
  const { sendNewReaction } = useSendNewReaction();

  const handleDoubleClick = () => {
    const userReaction = reactions.find(
      (reaction) => reaction?.user?.id === loggedInUserId
    );

    if (userReaction?.reaction !== "❤️") {
      deleteReaction({ chatId, messageId });
      sendNewReaction({ chatId, messageId, reaction: "❤️" });
    } else if (userReaction.reaction === "❤️") {
      deleteReaction({ chatId, messageId });
    } else {
      sendNewReaction({ chatId, messageId, reaction: "❤️" });
    }
  };

  return { handleDoubleClick };
};
