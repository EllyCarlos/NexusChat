import { Message } from "@/interfaces/message.interface";
import { useEffect } from "react";

type PropTypes = {
  message: Message,
  setReactionMenuMessageId: React.Dispatch<
    React.SetStateAction<string | undefined>
  >
}

export const useCloseReactionsMenuWhenZeroReactions = ({message,setReactionMenuMessageId}:PropTypes) => {
  useEffect(() => {
    if (message?.reactions?.length === 0) setReactionMenuMessageId(undefined);
  }, [message?.reactions?.length, setReactionMenuMessageId]);
};
