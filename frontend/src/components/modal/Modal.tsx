import { motion } from "framer-motion"; // For animations
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom"; // Function for creating portals
import { selectisDarkMode } from "../../lib/client/slices/uiSlice"; // Selector to determine if dark mode is enabled
import { useAppSelector } from "../../lib/client/store/hooks"; // Custom hook to access the Redux state

// Define the types for the modal props to ensure type safety in TypeScript
type PropTypes = {
  onClose: () => void; // Callback function to handle modal close events
  isOpen: boolean; // Boolean to determine if the modal is visible
  children: React.ReactNode; // The content to render inside the modal
  width?: number; // Optional width of the modal
  height?: number; // Optional height of the modal
  isCallModal?:boolean
};

const subscribeToClient = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export const Modal = ({
  isOpen = false,
  onClose,
  children,
  height,
  isCallModal=false
}: PropTypes) => {
  // Access the current dark mode state from the Redux store
  const isDarkMode = useAppSelector(selectisDarkMode);

  const mounted = useSyncExternalStore(
    subscribeToClient,
    getClientSnapshot,
    getServerSnapshot
  );

  // If the modal is not open or the component is not yet mounted on the client, render nothing
  if (!isOpen || !mounted) return null;

  // Use React Portals to render the modal content outside of the main DOM hierarchy
  return createPortal(
    <div
      onClick={isCallModal?()=>"":onClose} // Clicking outside the modal content triggers the `onClose` function
      className="z-50 bg-black bg-opacity-15 w-screen h-screen absolute flex items-center justify-center text-text bg-background"
    >
      {/* Use Framer Motion for animation when the modal appears */}
      <motion.div
        initial={{ y: -10, opacity: 0 }} // Initial animation state
        animate={{ y: 0, opacity: 1 }} // Target animation state
        onClick={(e) => e.stopPropagation()} // Prevent the click event from propagating to the overlay
        className={`min-w-[30rem] max-w-[35rem] max-sm:w-[90%] max-sm:min-w-[auto] h-[${
          height || "auto"
        }rem] rounded-lg p-4 shadow-xl ${
          isDarkMode ? "bg-secondary-dark" : "bg-secondary"
        }`}
      >
        {children} {/* Render the content passed as children */}
      </motion.div>
    </div>,
    document.getElementById("modal-root") as HTMLElement // Render the modal into the modal root (defined in `layout.ts`)
  );
};
