import type { Message } from "@/interfaces/message.interface";

export const PRIVATE_MESSAGE_SEARCH_RESULT_TARGET = 20;
export const PRIVATE_MESSAGE_SEARCH_CHUNK_SIZE = 20;
export const PRIVATE_MESSAGE_SEARCH_MAX_REQUESTS = 5;
export const PRIVATE_MESSAGE_SEARCH_MAX_DECRYPTIONS = 100;
export const PRIVATE_MESSAGE_SEARCH_MIN_QUERY_CODE_POINTS = 2;
export const PRIVATE_MESSAGE_SEARCH_MAX_QUERY_CODE_POINTS = 100;

export type PrivateMessageSearchValidationFailure = "too-short" | "too-long";

export type PrivateMessageSearchValidation =
  | {
      ok: true;
      query: string;
      normalizedQuery: string;
    }
  | {
      ok: false;
      reason: PrivateMessageSearchValidationFailure;
    };

export type PrivateMessageSearchCacheEntry =
  | {
      ciphertext: string;
      status: "ok";
      plaintext: string;
      normalizedPlaintext: string;
    }
  | {
      ciphertext: string;
      status: "failed";
      plaintext: null;
      normalizedPlaintext: null;
    };

export type PrivateMessageSearchResult = {
  id: string;
  chatId: string;
  createdAt: Message["createdAt"];
  text: string;
  isEdited: boolean;
  sender: Message["sender"];
};

export type PrivateMessageSearchStatus =
  | "idle"
  | "invalid"
  | "ready"
  | "unavailable"
  | "cancelled";

export type PrivateMessageSearchOutcome = {
  status: PrivateMessageSearchStatus;
  validationError: PrivateMessageSearchValidationFailure | null;
  results: PrivateMessageSearchResult[];
  historyExhausted: boolean;
  workCapReached: boolean;
  networkInterrupted: boolean;
  requestCount: number;
  decryptionCount: number;
};

export type PrivateMessageSearchBootstrapResponse = {
  messages: Message[];
  totalPages: number;
};

export type PrivateMessageSearchContextResponse = {
  anchorMessageId: string;
  messages: Message[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
};

export type PrivateMessageSearchLiveState = {
  newMessages?: ReadonlyMap<string, Message>;
  editedCiphertexts?: ReadonlyMap<string, string>;
  tombstones?: ReadonlySet<string>;
};

type SearchPrivateMessagesInput = {
  chatId: string;
  query: string;
  loadedMessages: readonly Message[];
  plaintextCache: Map<string, PrivateMessageSearchCacheEntry>;
  decrypt: (ciphertext: string) => Promise<string | null | undefined>;
  fetchBootstrap: (args: {
    chatId: string;
    limit: number;
  }) => Promise<PrivateMessageSearchBootstrapResponse>;
  fetchContext: (args: {
    chatId: string;
    messageId: string;
    before: number;
    after: number;
  }) => Promise<PrivateMessageSearchContextResponse>;
  getLiveState?: () => PrivateMessageSearchLiveState;
  isCurrent?: () => boolean;
  resultTarget?: number;
  chunkSize?: number;
  maxRequests?: number;
  maxDecryptions?: number;
};

const emptyOutcome = ({
  status,
  validationError = null,
}: {
  status: PrivateMessageSearchStatus;
  validationError?: PrivateMessageSearchValidationFailure | null;
}): PrivateMessageSearchOutcome => ({
  status,
  validationError,
  results: [],
  historyExhausted: false,
  workCapReached: false,
  networkInterrupted: false,
  requestCount: 0,
  decryptionCount: 0,
});

export const countUnicodeCodePoints = (value: string) => [...value].length;

export const normalizePrivateMessageSearchText = (value: string) =>
  value.normalize("NFC").toLowerCase();

export const validatePrivateMessageSearchQuery = (
  value: string,
): PrivateMessageSearchValidation => {
  const query = value.trim();
  const codePointLength = countUnicodeCodePoints(query);

  if (codePointLength < PRIVATE_MESSAGE_SEARCH_MIN_QUERY_CODE_POINTS) {
    return { ok: false, reason: "too-short" };
  }

  if (codePointLength > PRIVATE_MESSAGE_SEARCH_MAX_QUERY_CODE_POINTS) {
    return { ok: false, reason: "too-long" };
  }

  return {
    ok: true,
    query,
    normalizedQuery: normalizePrivateMessageSearchText(query),
  };
};

const isSearchablePrivateTextMessage = (message: Message, chatId: string) =>
  message.chatId === chatId
  && message.isTextMessage === true
  && message.isPollMessage === false
  && typeof message.textMessageContent === "string"
  && message.textMessageContent.length > 0;

const toTimestamp = (value: Message["createdAt"]) => {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const compareNewestFirst = (a: Message, b: Message) => {
  const timeDifference = toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
  if (timeDifference !== 0) return timeDifference;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
};

const compareOldestFirst = (a: Message, b: Message) => {
  const timeDifference = toTimestamp(a.createdAt) - toTimestamp(b.createdAt);
  if (timeDifference !== 0) return timeDifference;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
};

const applyLiveVersion = (
  message: Message,
  liveState: PrivateMessageSearchLiveState,
): Message | null => {
  if (liveState.tombstones?.has(message.id)) return null;

  const latestMessage = liveState.newMessages?.get(message.id) ?? message;
  const editedCiphertext = liveState.editedCiphertexts?.get(message.id);

  if (editedCiphertext === undefined) return latestMessage;

  return {
    ...latestMessage,
    isEdited: true,
    textMessageContent: editedCiphertext,
  };
};

const materializeCurrentMessages = ({
  messagesById,
  liveState,
}: {
  messagesById: Map<string, Message>;
  liveState: PrivateMessageSearchLiveState;
}) => {
  const currentMessages = new Map(messagesById);

  liveState.newMessages?.forEach((message, id) => {
    currentMessages.set(id, message);
  });

  liveState.tombstones?.forEach((messageId) => {
    currentMessages.delete(messageId);
  });

  return Array.from(currentMessages.values())
    .map((message) => applyLiveVersion(message, liveState))
    .filter((message): message is Message => message !== null)
    .sort(compareNewestFirst);
};

const mergeLowerPrecedenceMessages = (
  messagesById: Map<string, Message>,
  messages: readonly Message[],
) => {
  messages.forEach((message) => {
    if (!messagesById.has(message.id)) {
      messagesById.set(message.id, message);
    }
  });
};

const getOldestMessage = (messages: readonly Message[]) =>
  [...messages].sort(compareOldestFirst)[0] ?? null;

export const searchPrivateMessages = async ({
  chatId,
  query,
  loadedMessages,
  plaintextCache,
  decrypt,
  fetchBootstrap,
  fetchContext,
  getLiveState = () => ({}),
  isCurrent = () => true,
  resultTarget = PRIVATE_MESSAGE_SEARCH_RESULT_TARGET,
  chunkSize = PRIVATE_MESSAGE_SEARCH_CHUNK_SIZE,
  maxRequests = PRIVATE_MESSAGE_SEARCH_MAX_REQUESTS,
  maxDecryptions = PRIVATE_MESSAGE_SEARCH_MAX_DECRYPTIONS,
}: SearchPrivateMessagesInput): Promise<PrivateMessageSearchOutcome> => {
  const validation = validatePrivateMessageSearchQuery(query);

  if (validation.ok === false) {
    return emptyOutcome({
      status: validation.reason === "too-short" ? "idle" : "invalid",
      validationError: validation.reason,
    });
  }

  if (!isCurrent()) {
    return emptyOutcome({ status: "cancelled" });
  }

  const messagesById = new Map<string, Message>();
  loadedMessages.forEach((message) => {
    if (message.chatId === chatId) messagesById.set(message.id, message);
  });

  let requestCount = 0;
  let decryptionCount = 0;
  let historyExhausted = false;
  let workCapReached = false;
  let networkInterrupted = false;
  let attemptedBootstrap = false;
  let anchorMessageId: string | null = null;
  const visitedAnchors = new Set<string>();

  const collectMatches = async () => {
    const liveState = getLiveState();
    const currentMessages = materializeCurrentMessages({ messagesById, liveState });
    const results: PrivateMessageSearchResult[] = [];

    for (const message of currentMessages) {
      if (!isCurrent()) return { cancelled: true, results: [] as PrivateMessageSearchResult[] };
      if (!isSearchablePrivateTextMessage(message, chatId)) continue;

      const ciphertext = message.textMessageContent as string;
      const cached = plaintextCache.get(message.id);
      let cacheEntry = cached?.ciphertext === ciphertext ? cached : undefined;

      if (!cacheEntry) {
        if (decryptionCount >= maxDecryptions) {
          workCapReached = true;
          continue;
        }

        decryptionCount += 1;
        let plaintext: string | null | undefined;

        try {
          plaintext = await decrypt(ciphertext);
        } catch {
          plaintext = null;
        }

        if (!isCurrent()) return { cancelled: true, results: [] as PrivateMessageSearchResult[] };

        if (typeof plaintext === "string") {
          cacheEntry = {
            ciphertext,
            status: "ok",
            plaintext,
            normalizedPlaintext: normalizePrivateMessageSearchText(plaintext),
          };
        } else {
          cacheEntry = {
            ciphertext,
            status: "failed",
            plaintext: null,
            normalizedPlaintext: null,
          };
        }

        plaintextCache.set(message.id, cacheEntry);
      }

      if (
        cacheEntry.status === "ok"
        && cacheEntry.normalizedPlaintext.includes(validation.normalizedQuery)
      ) {
        results.push({
          id: message.id,
          chatId: message.chatId,
          createdAt: message.createdAt,
          text: cacheEntry.plaintext,
          isEdited: message.isEdited,
          sender: message.sender,
        });

        if (results.length >= resultTarget) break;
      }
    }

    return { cancelled: false, results };
  };

  const buildOutcome = async (): Promise<PrivateMessageSearchOutcome> => {
    const finalCollection = await collectMatches();
    if (finalCollection.cancelled || !isCurrent()) {
      return {
        ...emptyOutcome({ status: "cancelled" }),
        requestCount,
        decryptionCount,
      };
    }

    const liveState = getLiveState();
    const currentSearchableMessages = materializeCurrentMessages({ messagesById, liveState })
      .filter((message) => isSearchablePrivateTextMessage(message, chatId));
    const everySeenEligibleMessageResolved = currentSearchableMessages.every((message) => {
      const ciphertext = message.textMessageContent as string;
      return plaintextCache.get(message.id)?.ciphertext === ciphertext;
    });
    const hasSuccessfulDecryption = currentSearchableMessages.some((message) => {
      const ciphertext = message.textMessageContent as string;
      const entry = plaintextCache.get(message.id);
      return entry?.ciphertext === ciphertext && entry.status === "ok";
    });

    const allEligibleMessagesFailed = historyExhausted
      && currentSearchableMessages.length > 0
      && everySeenEligibleMessageResolved
      && !hasSuccessfulDecryption;

    return {
      status: allEligibleMessagesFailed ? "unavailable" : "ready",
      validationError: null,
      results: finalCollection.results.slice(0, resultTarget),
      historyExhausted,
      workCapReached,
      networkInterrupted,
      requestCount,
      decryptionCount,
    };
  };

  while (isCurrent()) {
    const currentCollection = await collectMatches();
    if (currentCollection.cancelled) {
      return {
        ...emptyOutcome({ status: "cancelled" }),
        requestCount,
        decryptionCount,
      };
    }

    if (currentCollection.results.length >= resultTarget) {
      return buildOutcome();
    }

    if (workCapReached || historyExhausted) {
      return buildOutcome();
    }

    const liveState = getLiveState();
    const currentMessages = materializeCurrentMessages({ messagesById, liveState })
      .filter((message) => message.chatId === chatId);
    const oldestKnownMessage = getOldestMessage(currentMessages);

    if (!oldestKnownMessage && !attemptedBootstrap) {
      if (requestCount >= maxRequests) {
        workCapReached = true;
        return buildOutcome();
      }

      attemptedBootstrap = true;
      requestCount += 1;

      try {
        const bootstrap = await fetchBootstrap({ chatId, limit: chunkSize });
        if (!isCurrent()) {
          return {
            ...emptyOutcome({ status: "cancelled" }),
            requestCount,
            decryptionCount,
          };
        }

        const bootstrapMessages = bootstrap.messages.filter((message) => message.chatId === chatId);
        mergeLowerPrecedenceMessages(messagesById, bootstrapMessages);
        historyExhausted = bootstrap.totalPages <= 1 || bootstrapMessages.length === 0;
        anchorMessageId = getOldestMessage(bootstrapMessages)?.id ?? null;
      } catch {
        if (!isCurrent()) {
          return {
            ...emptyOutcome({ status: "cancelled" }),
            requestCount,
            decryptionCount,
          };
        }
        networkInterrupted = true;
        return buildOutcome();
      }

      continue;
    }

    if (!anchorMessageId) {
      anchorMessageId = oldestKnownMessage?.id ?? null;
    }

    if (!anchorMessageId) {
      historyExhausted = true;
      return buildOutcome();
    }

    if (visitedAnchors.has(anchorMessageId)) {
      networkInterrupted = true;
      return buildOutcome();
    }

    if (requestCount >= maxRequests) {
      workCapReached = true;
      return buildOutcome();
    }

    visitedAnchors.add(anchorMessageId);
    requestCount += 1;

    try {
      const context = await fetchContext({
        chatId,
        messageId: anchorMessageId,
        before: chunkSize,
        after: 0,
      });

      if (!isCurrent()) {
        return {
          ...emptyOutcome({ status: "cancelled" }),
          requestCount,
          decryptionCount,
        };
      }

      const contextMessages = context.messages.filter((message) => message.chatId === chatId);
      mergeLowerPrecedenceMessages(messagesById, contextMessages);
      historyExhausted = !context.hasMoreBefore;

      const nextAnchor = getOldestMessage(contextMessages)?.id ?? null;
      if (nextAnchor === anchorMessageId && context.hasMoreBefore) {
        networkInterrupted = true;
        return buildOutcome();
      }
      anchorMessageId = nextAnchor;
    } catch {
      if (!isCurrent()) {
        return {
          ...emptyOutcome({ status: "cancelled" }),
          requestCount,
          decryptionCount,
        };
      }
      networkInterrupted = true;
      return buildOutcome();
    }
  }

  return {
    ...emptyOutcome({ status: "cancelled" }),
    requestCount,
    decryptionCount,
  };
};
