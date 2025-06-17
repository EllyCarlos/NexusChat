import { selectSelectedChatDetails } from "@/lib/client/slices/chatSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { Dispatch, SetStateAction, useEffect } from "react";

type PropTypes = {
  page: number;
  totalPages: number;
  hasMoreMessages: boolean;
  setHasMoreMessages: Dispatch<SetStateAction<boolean>>;
  isFetching: boolean;
  getPreviousMessages: ({
    chatId,
    page,
  }: {
    chatId: string;
    page: number;
  }) => void;
};

export const useFetchMessagesOnPageChange = ({
  page,
  totalPages,
  hasMoreMessages,
  getPreviousMessages,
  setHasMoreMessages,
  isFetching,
}: PropTypes) => {
  const selectedChatId = useAppSelector(selectSelectedChatDetails)?.id;

  useEffect(() => {
    // Only fetch messages if the page is greater than 1 (indicating the user wants older messages)
    // and if a selectedChatId exists
    if (page > 1 && hasMoreMessages && selectedChatId && !isFetching) {
      getPreviousMessages({ page, chatId: selectedChatId });
    }
    // If the current page equals totalPages, then there are no more messages to load
    if (page === totalPages) {
      setHasMoreMessages(false);
    }
  }, [page]);
};
