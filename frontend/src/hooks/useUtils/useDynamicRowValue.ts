import { useMediaQuery } from "./useMediaQuery"; // Custom hook to check media query breakpoints

// Custom hook to dynamically calculate the number of rows for a text area based on message length and screen width
export const useDynamicRowValue = () => {
  // Use the useMediaQuery hook to check if the screen width is below or above 640px
  const is640 = useMediaQuery(640);

  // Function to calculate the number of rows based on the message length and screen size
  const getRowValue = (messageLength: number) => {
    // If the screen width is less than or equal to 640px (mobile view)
    if (is640) {
      // Adjust the number of rows based on the length of the message
      if (messageLength >= 150) return 4; // If the message length is greater than or equal to 150, return 4 rows
      if (messageLength >= 90) return 3; // If the message length is greater than or equal to 90, return 3 rows
      if (messageLength >= 30)
        return 2; // If the message length is greater than or equal to 30, return 2 rows
      else return 1; // Otherwise, return 1 row
    } else {
      // If the screen width is greater than 640px (desktop view)
      if (messageLength >= 870) {
        return 8; // If the message length is greater than or equal to 870, return 8 rows
      }
      if (messageLength >= 750) {
        return 7; // If the message length is greater than or equal to 750, return 7 rows
      }
      if (messageLength >= 620) {
        return 6; // If the message length is greater than or equal to 620, return 6 rows
      }
      if (messageLength >= 500) {
        return 5; // If the message length is greater than or equal to 500, return 5 rows
      }
      if (messageLength >= 380) {
        return 4; // If the message length is greater than or equal to 380, return 4 rows
      }
      if (messageLength >= 250) {
        return 3; // If the message length is greater than or equal to 250, return 3 rows
      }
      if (messageLength >= 120) {
        return 2; // If the message length is greater than or equal to 120, return 2 rows
      } else {
        return 1; // Otherwise, return 1 row
      }
    }
  };

  // Return the getRowValue function so it can be used in the component
  return {
    getRowValue,
  };
};
