import { Message } from "@/interfaces/message.interface";
import { selectNewMessageFormed } from "@/lib/client/slices/uiSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { RefObject, useEffect } from "react";

type PropTypes = {
  container: RefObject<HTMLDivElement | null> // The container element that holds the chat messages
  isNearBottom : boolean; // A boolean indicating whether the user is near the bottom of the chat
  messages: Message[]; // The list of messages that triggers scrolling when updated
  prevHeightRef: RefObject<number>; // A ref to store the previous container height
  prevScrollTopRef: RefObject<number>; // A ref to store the previous scroll position
};

export const useScrollToBottomOnNewMessageWhenUserIsNearBottom = ({
  container,
  isNearBottom,
  messages,
  prevHeightRef,
  prevScrollTopRef,
}: PropTypes) => {


  const newMessageFormed = useAppSelector(selectNewMessageFormed);
  
  useEffect(()=>{
    prevHeightRef.current = 0;
    prevScrollTopRef.current = 0;
    let fallbackTimeout: ReturnType<typeof setTimeout> | undefined;
    const initialTimeout = setTimeout(() => {
      const currentContainer = container.current;
      if (currentContainer && isNearBottom) {
        console.log('ran man');
        currentContainer.scrollTop = currentContainer.scrollHeight;
        fallbackTimeout = setTimeout(() => {
          const fallbackContainer = container.current;
          if (fallbackContainer) {
            console.log('TRIGGERED FALLBACK');
            fallbackContainer.scrollTop = fallbackContainer.scrollHeight;
          }
        }, 300);
      }
    }, 50);

    return () => {
      clearTimeout(initialTimeout);
      if (fallbackTimeout) clearTimeout(fallbackTimeout);
    };
  }, [container, isNearBottom, messages.length, newMessageFormed, prevHeightRef, prevScrollTopRef]);

};


