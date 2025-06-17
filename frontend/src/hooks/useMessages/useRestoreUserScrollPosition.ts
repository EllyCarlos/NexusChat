import { RefObject, useEffect } from "react";

type PropTypes = {
  container: RefObject<HTMLDivElement | null>;
  page:number;
  prevHeightRef: RefObject<number>;
  prevScrollTopRef: RefObject<number>;
  IsFetchingMessages: boolean;

};

export const useRestoreUserScrollPosition = ({container,page,prevHeightRef,prevScrollTopRef,IsFetchingMessages}: PropTypes) => {
  useEffect(() => {
    // Only run this effect when:
    // 1. The user is on a page greater than 1 (loading older messages).
    // 2. The container element is available.
    // 3. Messages are not currently being fetched.
    if (page > 1 && container && !IsFetchingMessages && container.current) {
      // Preserve the user's previous scroll position after new messages are added.
      // Calculation:
      // - `container.scrollHeight`: The current total height of the scrollable content.
      // - `prevHeightRef.current`: The height of the scrollable content before new messages were loaded.
      // - `prevScrollTopRef.current`: The user's previous scroll position before new messages were loaded.
      // This ensures the user stays at the same relative position in the chat.
      container.current.scrollTop =
        container.current.scrollHeight -
        prevHeightRef.current +
        prevScrollTopRef.current;
    }
  }, [IsFetchingMessages]); // Dependencies: Re-run when fetching status or page changes.
};
