"use client";

import { Event } from "@/interfaces/events.interface";
import type { Message } from "@/interfaces/message.interface";
import { decryptMessage } from "@/lib/client/encryption";
import {
  type PrivateMessageSearchCacheEntry,
  type PrivateMessageSearchOutcome,
  type PrivateMessageSearchValidationFailure,
  searchPrivateMessages,
  validatePrivateMessageSearchQuery,
} from "@/lib/client/privateMessageSearch";
import {
  messageApi,
  useLazyGetMessageContextQuery,
  useLazyGetPrivateSearchBootstrapQuery,
} from "@/lib/client/rtk-query/message.api";
import { selectLoggedInUser } from "@/lib/client/slices/authSlice";
import { selectSelectedChatDetails } from "@/lib/client/slices/chatSlice";
import { useAppSelector } from "@/lib/client/store/hooks";
import { useEffect, useRef, useState } from "react";
import { useGetSharedKey } from "../useAuth/useGetSharedKey";
import { useSocketEvent } from "../useSocket/useSocketEvent";

const EMPTY_MESSAGES: Message[] = [];

type SearchHookStatus = Exclude<PrivateMessageSearchOutcome["status"], "cancelled"> | "searching";

export type PrivateMessageSearchHookResult = {
  status: SearchHookStatus;
  validationError: PrivateMessageSearchValidationFailure | null;
  results: PrivateMessageSearchOutcome["results"];
  historyExhausted: boolean;
  workCapReached: boolean;
  networkInterrupted: boolean;
  requestCount: number;
  decryptionCount: number;
};

const createInitialState = (): PrivateMessageSearchHookResult => ({
  status: "idle",
  validationError: null,
  results: [],
  historyExhausted: false,
  workCapReached: false,
  networkInterrupted: false,
  requestCount: 0,
  decryptionCount: 0,
});

type ActiveRequest = {
  abort: () => void;
};

type MessageEditEventReceivePayload = {
  chatId: string;
  messageId: string;
  updatedTextMessageContent: string;
};

type MessageDeleteEventReceivePayload = {
  chatId: string;
  messageId: string;
};

export const usePrivateMessageSearch = ({ query }: { query: string }) => {
  const loggedInUser = useAppSelector(selectLoggedInUser);
  const selectedChatDetails = useAppSelector(selectSelectedChatDetails);
  const selectedChatId = selectedChatDetails?.id ?? null;
  const isGroupChat = selectedChatDetails?.isGroupChat ?? false;
  const loggedInUserId = loggedInUser?.id ?? null;
  const needsKeyRecovery = loggedInUser?.needsKeyRecovery ?? false;
  const loggedInUserPublicKey = loggedInUser?.publicKey ?? null;
  const privatePeer = selectedChatDetails && !isGroupChat && loggedInUserId
    ? selectedChatDetails.ChatMembers.find(({ user }) => user.id !== loggedInUserId)?.user ?? null
    : null;
  const privatePeerId = privatePeer?.id ?? null;
  const privatePeerPublicKey = privatePeer?.publicKey ?? null;

  const loadedMessages = useAppSelector((state) => {
    if (!selectedChatId) return EMPTY_MESSAGES;
    return messageApi.endpoints.getMessagesByChatId.select({
      chatId: selectedChatId,
      page: 1,
    })(state).data?.messages ?? EMPTY_MESSAGES;
  });

  const { getSharedKey } = useGetSharedKey();
  const [fetchPrivateSearchBootstrap] = useLazyGetPrivateSearchBootstrapQuery();
  const [fetchMessageContext] = useLazyGetMessageContextQuery();

  const [state, setState] = useState<PrivateMessageSearchHookResult>(createInitialState);
  const [socketVersion, setSocketVersion] = useState(0);

  const operationGenerationRef = useRef(0);
  const activeRequestRef = useRef<ActiveRequest | null>(null);
  const plaintextCacheRef = useRef(new Map<string, PrivateMessageSearchCacheEntry>());
  const liveMessagesRef = useRef(new Map<string, Message>());
  const editedCiphertextsRef = useRef(new Map<string, string>());
  const tombstonesRef = useRef(new Set<string>());

  useSocketEvent(Event.MESSAGE, (newMessage: Message) => {
    if (
      !selectedChatId
      || isGroupChat
      || newMessage.chatId !== selectedChatId
    ) {
      return;
    }

    liveMessagesRef.current.set(newMessage.id, newMessage);
    setSocketVersion((current) => current + 1);
  });

  useSocketEvent(
    Event.MESSAGE_EDIT,
    ({ chatId, messageId, updatedTextMessageContent }: MessageEditEventReceivePayload) => {
      if (!selectedChatId || isGroupChat || chatId !== selectedChatId) {
        return;
      }

      editedCiphertextsRef.current.set(messageId, updatedTextMessageContent);
      plaintextCacheRef.current.delete(messageId);

      const liveMessage = liveMessagesRef.current.get(messageId);
      if (liveMessage) {
        liveMessagesRef.current.set(messageId, {
          ...liveMessage,
          isEdited: true,
          textMessageContent: updatedTextMessageContent,
        });
      }

      setSocketVersion((current) => current + 1);
    },
  );

  useSocketEvent(
    Event.MESSAGE_DELETE,
    ({ chatId, messageId }: MessageDeleteEventReceivePayload) => {
      if (!selectedChatId || isGroupChat || chatId !== selectedChatId) {
        return;
      }

      tombstonesRef.current.add(messageId);
      liveMessagesRef.current.delete(messageId);
      editedCiphertextsRef.current.delete(messageId);
      plaintextCacheRef.current.delete(messageId);
      setSocketVersion((current) => current + 1);
    },
  );

  useEffect(() => {
    const plaintextCache = plaintextCacheRef.current;
    const liveMessages = liveMessagesRef.current;
    const editedCiphertexts = editedCiphertextsRef.current;
    const tombstones = tombstonesRef.current;

    operationGenerationRef.current += 1;
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    plaintextCache.clear();
    liveMessages.clear();
    editedCiphertexts.clear();
    tombstones.clear();

    return () => {
      operationGenerationRef.current += 1;
      activeRequestRef.current?.abort();
      activeRequestRef.current = null;
      plaintextCache.clear();
      liveMessages.clear();
      editedCiphertexts.clear();
      tombstones.clear();
    };
  }, [
    loggedInUserId,
    loggedInUserPublicKey,
    needsKeyRecovery,
    privatePeerId,
    privatePeerPublicKey,
    selectedChatId,
  ]);

  useEffect(() => {
    const isPrivateChat = Boolean(selectedChatId && !isGroupChat);
    const validation = validatePrivateMessageSearchQuery(query);

    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    const generation = operationGenerationRef.current + 1;
    operationGenerationRef.current = generation;
    const isCurrent = () => operationGenerationRef.current === generation;

    void (async () => {
      await Promise.resolve();
      if (!isCurrent()) return;

      if (!isPrivateChat) {
        setState(createInitialState());
        return;
      }

      if (validation.ok === false) {
        setState({
          ...createInitialState(),
          status: validation.reason === "too-long" ? "invalid" : "idle",
          validationError: validation.reason === "too-long" ? validation.reason : null,
        });
        return;
      }

      if (
        !loggedInUserId
        || needsKeyRecovery
        || !selectedChatId
        || !privatePeerId
      ) {
        setState({ ...createInitialState(), status: "unavailable" });
        return;
      }

      setState({ ...createInitialState(), status: "searching" });

      let sharedKey: CryptoKey | undefined;

      try {
        sharedKey = await getSharedKey({
          loggedInUserId,
          otherMember: {
            id: privatePeerId,
            publicKey: privatePeerPublicKey,
          },
        });
      } catch {
        sharedKey = undefined;
      }

      if (!isCurrent()) return;

      if (!sharedKey) {
        setState({ ...createInitialState(), status: "unavailable" });
        return;
      }
      const operationSharedKey = sharedKey;

      let outcome: PrivateMessageSearchOutcome;
      try {
        outcome = await searchPrivateMessages({
          chatId: selectedChatId,
          query,
          loadedMessages,
          plaintextCache: plaintextCacheRef.current,
          decrypt: (ciphertext) => decryptMessage(operationSharedKey, ciphertext),
          fetchBootstrap: async ({ chatId, limit }) => {
            const request = fetchPrivateSearchBootstrap({ chatId, limit }, false);
            activeRequestRef.current = request;
            try {
              return await request.unwrap();
            } finally {
              if (activeRequestRef.current === request) {
                activeRequestRef.current = null;
              }
            }
          },
          fetchContext: async ({ chatId, messageId, before, after }) => {
            const request = fetchMessageContext({
              chatId,
              messageId,
              before,
              after,
            }, false);
            activeRequestRef.current = request;
            try {
              return await request.unwrap();
            } finally {
              if (activeRequestRef.current === request) {
                activeRequestRef.current = null;
              }
            }
          },
          getLiveState: () => ({
            newMessages: liveMessagesRef.current,
            editedCiphertexts: editedCiphertextsRef.current,
            tombstones: tombstonesRef.current,
          }),
          isCurrent,
        });
      } catch {
        if (isCurrent()) {
          setState({ ...createInitialState(), status: "unavailable" });
        }
        return;
      }

      if (!isCurrent() || outcome.status === "cancelled") return;

      setState({
        status: outcome.status,
        validationError: outcome.validationError,
        results: outcome.results,
        historyExhausted: outcome.historyExhausted,
        workCapReached: outcome.workCapReached,
        networkInterrupted: outcome.networkInterrupted,
        requestCount: outcome.requestCount,
        decryptionCount: outcome.decryptionCount,
      });
    })();

    return () => {
      if (operationGenerationRef.current === generation) {
        operationGenerationRef.current += 1;
        activeRequestRef.current?.abort();
        activeRequestRef.current = null;
      }
    };
  }, [
    fetchMessageContext,
    fetchPrivateSearchBootstrap,
    getSharedKey,
    isGroupChat,
    loadedMessages,
    loggedInUserId,
    loggedInUserPublicKey,
    needsKeyRecovery,
    privatePeerId,
    privatePeerPublicKey,
    query,
    selectedChatId,
    socketVersion,
  ]);

  return state;
};
