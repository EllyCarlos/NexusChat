import { RefObject, useEffect } from "react";

// Custom hook to detect clicks outside a specified element
export const useHandleOutsideClick = (
  ref: RefObject<HTMLDivElement | null> | RefObject<HTMLUListElement | null>,
  callback: () => void
) => {
  // Function to handle mouse clicks and check if the click is outside the referenced element
  const handleClickOutside = (event: MouseEvent) => {
    // Check if the reference element exists and if the clicked target is not inside that element
    if (ref.current && !(ref.current as any).contains(event.target)) {
      // If clicked outside, invoke the callback function passed as an argument
      callback();
    }
  };

  // The effect will run when the component mounts and when ref or callback changes
  useEffect(() => {
    // Attach the handleClickOutside function to the document's mousedown event
    document.addEventListener("mousedown", handleClickOutside);

    // Cleanup function to remove the event listener when the component is unmounted or dependencies change
    return () => {
      // Remove the event listener to prevent memory leaks or multiple event listeners
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [ref, callback]); // The effect depends on 'ref' and 'callback' to re-run when these change
};
