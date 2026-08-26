import { selectSelectedChatDetails } from "@/lib/client/slices/chatSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { Dispatch, SetStateAction, useEffect, useRef } from "react";

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

type PreviousMessageRequestTracking = {
  previousSelectedChatIdRef: { current: string | undefined };
  lastRequestKeyRef: { current: string | undefined };
};

export const getPreviousMessageRequest = ({
  selectedChatId,
  page,
  hasMoreMessages,
  isFetching,
  previousSelectedChatIdRef,
  lastRequestKeyRef,
}: {
  selectedChatId: string | undefined;
  page: number;
  hasMoreMessages: boolean;
  isFetching: boolean;
} & PreviousMessageRequestTracking) => {
  if (previousSelectedChatIdRef.current !== selectedChatId) {
    previousSelectedChatIdRef.current = selectedChatId;
    lastRequestKeyRef.current = undefined;
    return { chatChanged: true, request: null };
  }

  const requestKey = `${selectedChatId ?? ""}:${page}`;
  if (
    page <= 1 ||
    !hasMoreMessages ||
    !selectedChatId ||
    isFetching ||
    requestKey === lastRequestKeyRef.current
  ) {
    return { chatChanged: false, request: null };
  }

  lastRequestKeyRef.current = requestKey;
  return {
    chatChanged: false,
    request: { page, chatId: selectedChatId },
  };
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
  const previousSelectedChatIdRef = useRef<string | undefined>(selectedChatId);
  const lastRequestKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const decision = getPreviousMessageRequest({
      selectedChatId,
      page,
      hasMoreMessages,
      isFetching,
      previousSelectedChatIdRef,
      lastRequestKeyRef,
    });
    if (decision.chatChanged) {
      return;
    }
    if (decision.request) {
      getPreviousMessages(decision.request);
    }

    // If the current page equals totalPages, then there are no more messages to load
    if (page === totalPages) {
      setHasMoreMessages(false);
    }
  }, [
    getPreviousMessages,
    hasMoreMessages,
    isFetching,
    page,
    selectedChatId,
    setHasMoreMessages,
    totalPages,
  ]);
};
