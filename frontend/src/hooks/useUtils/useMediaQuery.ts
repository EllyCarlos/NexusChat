import { useCallback, useSyncExternalStore } from 'react';

// Custom hook to detect media query matches (screen size) and react to changes
export const useMediaQuery = (number: number) => {

  // Construct the media query string based on the passed number
  // E.g., if number = 640, the query will be `(max-width:639px)` which matches screens with widths <= 639px
  const query = `(max-width:${number - 1}px)`;

  const subscribe = useCallback((onStoreChange: () => void) => {
    const mediaQuery = window.matchMedia(query);
    mediaQuery.addEventListener('change', onStoreChange);
    return () => {
      mediaQuery.removeEventListener('change', onStoreChange);
    };
  }, [query]);

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
};
