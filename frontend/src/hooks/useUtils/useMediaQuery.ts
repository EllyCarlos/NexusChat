import { useEffect, useState } from 'react';

// Custom hook to detect media query matches (screen size) and react to changes
export const useMediaQuery = (number: number) => {

  // Construct the media query string based on the passed number
  // E.g., if number = 640, the query will be `(max-width:639px)` which matches screens with widths <= 639px
  const query = `(max-width:${number - 1}px)`;

  // Initialize state to false initially. It will be updated on the client-side.
  const [isMatches, setIsMatches] = useState<boolean>(false); 

  useEffect(() => {
    // This code only runs on the client-side, where 'window' is defined.
    if (typeof window === 'undefined') {
      // This guard is technically redundant because useEffect only runs on client,
      // but it serves as an explicit reminder.
      return;
    }

    // Create a MediaQueryList object that listens to changes in the media query match
    const mediaQuery = window.matchMedia(query);

    // Handler function to be called when the media query matches or doesn't match
    const handleMediaQueryChange = (event: MediaQueryListEvent | MediaQueryList) => {
      // Update the state to reflect whether the media query matches or not
      setIsMatches(event.matches);
    };

    // Set initial match status on the client after mounting
    setIsMatches(mediaQuery.matches); // <-- Update state with actual match status

    // Attach the event listener to monitor changes in the media query match status
    mediaQuery.addEventListener('change', handleMediaQueryChange);

    // Cleanup function to remove the event listener when the component is unmounted or the query changes
    return () => {
      mediaQuery.removeEventListener('change', handleMediaQueryChange);
    };

  }, [query]); // The effect depends on 'query', so it will run when the query changes (if number changes)

  // Return the current status of whether the media query matches
  return isMatches;
};
