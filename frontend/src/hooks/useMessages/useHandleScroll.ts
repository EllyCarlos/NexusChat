import { Dispatch, RefObject, SetStateAction } from "react";

type PropTypes = {
    container:  RefObject<HTMLDivElement | null>
    hasMoreMessages: boolean
    IsFetchingMessages: boolean;
    prevHeightRef: React.RefObject<number>;
    prevScrollTopRef: React.RefObject<number>;
    setIsNearBottom: Dispatch<SetStateAction<boolean>>
    setPage: Dispatch<SetStateAction<number>>;
}

export const useHandleScroll = ({IsFetchingMessages,container,hasMoreMessages,prevHeightRef,prevScrollTopRef,setPage,setIsNearBottom}:PropTypes) => {


  const handleScroll = () => {
    // Check if we are close to the top to load more messages
    if (container && container.current && container.current.scrollTop <= 284 && hasMoreMessages && !IsFetchingMessages) {
      // Save the current scroll height and scroll position before loading more messages,
      // so we can preserve the user's scroll position later.
      prevHeightRef.current = container.current.scrollHeight;
      prevScrollTopRef.current = container.current.scrollTop;

      // Increment the page number to trigger the loading of the next set of messages.
      setPage(prev=>prev+1);
    }

    if(container && container.current){
      // Check if we are near the bottom of the container
      // Calculate if the user is near the bottom of the container:
      // - `container.scrollHeight - container.scrollTop`: This gives the distance from the bottom of the content to the current scroll position.
      // - `container.clientHeight`: The visible height of the container.
      // - `+ 150`: This offset (150px) allows us to trigger the "near bottom" condition slightly before reaching the exact bottom.
      const isAtBottom = container.current.scrollHeight - container.current.scrollTop <= container.current.clientHeight + 150;
      // Update the state to reflect whether the user is near the bottom.
      setIsNearBottom(isAtBottom);
    }

  };

  return {handleScroll}

};
