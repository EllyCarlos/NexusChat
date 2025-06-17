import { selectSelectedChatDetails } from "@/lib/client/slices/chatSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { RefObject, useEffect } from "react";

type PropTypes = {
  messageContainerRef: RefObject<HTMLDivElement | null>;
};

export const useScrollToBottomOnChatSelect = ({
  messageContainerRef,
}: PropTypes) => {
  const selectedChatId = useAppSelector(selectSelectedChatDetails)?.id;

  useEffect(() => {
    const container = messageContainerRef.current;
    let timeoutId: NodeJS.Timeout;
    if (container) {
      // Use setTimeout to wait for a moment before scrolling to the bottom
      // This is necessary to allow for any updates (like rendering new messages) to complete before scrolling
      timeoutId = setTimeout(() => {
        container.scrollTop = container.scrollHeight; // Scroll to the bottom of the container
      }, 100);
    }
    return () => {
      clearTimeout(timeoutId);
    };
  }, [selectedChatId]);
};
