import { messageApi } from "@/lib/client/rtk-query/message.api";
import { selectSelectedChatDetails } from "@/lib/client/slices/chatSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";
import { useCallback, useEffect } from "react";

/**
 * Hook: useClearExtraPreviousMessagesOnChatChange
 *
 * Purpose:
 * This hook ensures that when the user switches between chats, the messages from
 * the previously selected chat are pruned to keep only the most relevant messages.
 * The primary goal is to limit the number of stored messages to 20 while prioritizing
 * the messages marked as `isNew` (unread or recently added messages).
 *
 * Logic:
 * 1. When the selected chat changes, this hook runs a cleanup operation before switching.
 * 2. It updates the message state for the previous chat to retain only the last 20 messages.
 * 3. If there are more than 20 `isNew` messages, only the most recent 20 are retained.
 * 4. If there are fewer than 20 `isNew` messages, the remaining slots are filled
 *    with the latest older messages (`!isNew`).
 * 5. This prevents excessive memory usage and ensures that the state remains optimized
 *    while maintaining the relevance of stored messages.
 *
 * Use Case:
 * - Useful in chat applications where multiple chats can have unread messages.
 * - Helps in managing message states efficiently without losing important context.
 *
 * Dependencies:
 * - Redux Toolkit Query (`messageApi.util.updateQueryData`) is used to update the cached state.
 * - Redux selectors (`selectSelectedChatDetails`) and dispatch hooks are leveraged to manage state.
 */

export const useClearExtraPreviousMessagesOnChatChange = () => {
  // Get the currently selected chat's ID from Redux state
  const selectedChatId = useAppSelector(selectSelectedChatDetails)?.id;
  const dispatch = useAppDispatch();

  /**
   * Prunes the messages for a given chat ID to keep only the latest 20.
   * Prioritizes `isNew` messages and fills remaining slots with older messages.
   *
   * @param chatId - The ID of the chat for which messages should be pruned
   */
  const pruneMessagesOnChatChange = useCallback(
    (chatId: string) => {
      dispatch(
        messageApi.util.updateQueryData(
          "getMessagesByChatId", // Query key to identify the query
          { chatId, page: 1 }, // Parameters used to fetch the messages
          (draft) => {
            // Extract the messages marked as new
            const newMessages = draft.messages.filter(
              (message) => message?.isNew
            );

            let messagesToKeep = [];

            if (newMessages.length >= 20) {
              // If there are 20 or more `isNew` messages, keep only the last 20
              messagesToKeep = newMessages.slice(-20);
            } else {
              // Calculate how many additional messages are needed to reach 20
              const remainingSlots = 20 - newMessages.length;

              // Take the most recent older messages (not marked as `isNew`) to fill the gap
              const olderMessages = draft.messages
                .filter((message) => !message?.isNew) // Exclude new messages
                .slice(-remainingSlots); // Take only enough messages to fill the gap

              // Combine older messages with `isNew` messages to form the final list
              messagesToKeep = [...olderMessages, ...newMessages];
            }

            // Update the draft messages with the pruned list
            draft.messages = messagesToKeep;
          }
        )
      );
    },
    [dispatch]
  );

  // Effect to clean up messages when the selected chat changes
  useEffect(() => {
    return () => {
      // Only prune messages if there's a currently selected chat
      if (selectedChatId) {
        pruneMessagesOnChatChange(selectedChatId);
      }
    };
  }, [pruneMessagesOnChatChange, selectedChatId]); // Re-run the effect when the selected chat ID
};
