import { useDeleteReaction } from "@/hooks/useMessages/useDeleteReaction";
import { Message } from "@/interfaces/message.interface";
import Image from "next/image";

type PropTypes = {
  reaction: Message["reactions"][0];
  loggedInUserId: string;
  chatId: string;
  messageId: string;
};

export const MessageReactionListItem = ({
  reaction,
  loggedInUserId,
  chatId,
  messageId,
}: PropTypes) => {

  const myReaction = reaction.user.id === loggedInUserId;
  const { deleteReaction } = useDeleteReaction();

  const handleReactionClick = () => {
    if (myReaction) deleteReaction({ chatId, messageId });
  };

  return (
    <div
      onClick={handleReactionClick}
      key={reaction.user.id}
      className={`flex items-center justify-between ${
        myReaction ? "cursor-pointer" : ""
      }`}
    >
      <div className="flex items-center gap-x-3">
        <Image
          className="rounded-full size-10"
          src={reaction?.user?.avatar}
          alt={reaction?.user?.username}
          width={100}
          height={100}
        />
        <div className="flex flex-col">
          <p>{reaction.user?.username}</p>
          {myReaction && <p className="text-sm">Tap to remove</p>}
        </div>
      </div>
      <span className="text-xl">{reaction.reaction}</span>
    </div>
  );
};
