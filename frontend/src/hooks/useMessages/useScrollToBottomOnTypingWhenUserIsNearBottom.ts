import { selectSelectedChatDetails } from "@/lib/client/slices/chatSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { RefObject, useEffect } from "react";

type PropTypes = {
  container: RefObject<HTMLDivElement | null>;
  isNearBottom: boolean;
};

const scrollToBottom = (container: HTMLDivElement) => {
  container.scrollTop = container.scrollHeight;
};

export const useScrollToBottomOnTypingWhenUserIsNearBottom = ({
  container,
  isNearBottom,
}: PropTypes) => {
  // this hook is responsible for scrolling to bottom when other user's are typing but only if the user is near the bottom
  // as if the user is reading old messages and someone starts typing, we don't want to scroll to bottom

  const selectedChatDetails = useAppSelector(selectSelectedChatDetails);
  const isAnyUserTyping = selectedChatDetails && selectedChatDetails.typingUsers.length > 0;

  useEffect(() => {
    const currentContainer = container.current;
    if (currentContainer && isAnyUserTyping && isNearBottom) {
      scrollToBottom(currentContainer);
    }
  }, [container, isAnyUserTyping, isNearBottom]);
};
