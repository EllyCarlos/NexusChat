import { Message } from "@/interfaces/message.interface";
import { DisplayFirst3ReactionsAndRemainingReactionsCounts } from "./DisplayFirst3ReactionsAndRemainingReactionsCounts";

type PropTypes = {
  message: Message;
  setReactionMenuMessageId: (messageId: string) => void;
};

export const MessageReactions = ({
  message,
  setReactionMenuMessageId,
}: PropTypes) => {
  return (
    <div
      onClick={() => setReactionMenuMessageId(message.id)}
      className="bg-secondary-dark self-end px-1 rounded-lg flex items-center -mt-1 cursor-pointer"
    >
      <DisplayFirst3ReactionsAndRemainingReactionsCounts
        reactions={message.reactions}
      />
    </div>
  );
};
