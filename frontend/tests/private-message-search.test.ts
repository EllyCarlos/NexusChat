import { describe, expect, it, vi } from "vitest";
import type { Message } from "@/interfaces/message.interface";
import {
  PRIVATE_MESSAGE_SEARCH_MAX_DECRYPTIONS,
  PRIVATE_MESSAGE_SEARCH_MAX_QUERY_CODE_POINTS,
  PRIVATE_MESSAGE_SEARCH_MAX_REQUESTS,
  countUnicodeCodePoints,
  normalizePrivateMessageSearchText,
  searchPrivateMessages,
  type PrivateMessageSearchBootstrapResponse,
  type PrivateMessageSearchCacheEntry,
  validatePrivateMessageSearchQuery,
} from "@/lib/client/privateMessageSearch";

const CHAT_ID = "private-chat";

const makeMessage = ({
  id,
  plaintext,
  ciphertext = `enc:${plaintext}`,
  createdAt = new Date("2026-09-09T12:00:00.000Z"),
  isTextMessage = true,
  isPollMessage = false,
  isEdited = false,
}: {
  id: string;
  plaintext: string;
  ciphertext?: string;
  createdAt?: Date;
  isTextMessage?: boolean;
  isPollMessage?: boolean;
  isEdited?: boolean;
}): Message => ({
  sender: {
    id: `sender-${id}`,
    username: `user-${id}`,
    avatar: "avatar",
  },
  attachments: [],
  replyToMessage: null,
  poll: null,
  reactions: [],
  id,
  isTextMessage,
  textMessageContent: ciphertext,
  chatId: CHAT_ID,
  url: null,
  isPollMessage,
  isEdited,
  audioUrl: null,
  createdAt,
  updatedAt: createdAt,
  isPinned: false,
});

const makeDecrypt = () => vi.fn(async (ciphertext: string) => {
  if (!ciphertext.startsWith("enc:")) return null;
  return ciphertext.slice(4);
});

const noBootstrap = vi.fn(async () => ({ messages: [], totalPages: 1 }));
const exhaustedContext = vi.fn(async ({ messageId }: { messageId: string }) => ({
  anchorMessageId: messageId,
  messages: [],
  hasMoreBefore: false,
  hasMoreAfter: false,
}));

const runSearch = (overrides: Partial<Parameters<typeof searchPrivateMessages>[0]> = {}) => {
  const decrypt = makeDecrypt();
  const plaintextCache = new Map<string, PrivateMessageSearchCacheEntry>();

  return {
    decrypt,
    plaintextCache,
    promise: searchPrivateMessages({
      chatId: CHAT_ID,
      query: "needle",
      loadedMessages: [],
      plaintextCache,
      decrypt,
      fetchBootstrap: noBootstrap,
      fetchContext: exhaustedContext,
      ...overrides,
    }),
  };
};

describe("private message search semantics", () => {
  it("trims query edges, normalizes NFC, and matches case-insensitive literal substrings", async () => {
    const message = makeMessage({
      id: "m1",
      plaintext: "A Cafe\u0301 HELLO to you",
    });
    const { promise } = runSearch({
      query: "  café hello  ",
      loadedMessages: [message],
      resultTarget: 1,
    });

    const outcome = await promise;

    expect(outcome.status).toBe("ready");
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]?.text).toBe("A Cafe\u0301 HELLO to you");
  });

  it("keeps internal whitespace and punctuation literal", async () => {
    const message = makeMessage({ id: "m1", plaintext: "hello  world!" });

    const spacing = await runSearch({
      query: "hello world",
      loadedMessages: [message],
      maxRequests: 0,
    }).promise;
    const punctuation = await runSearch({
      query: "world?",
      loadedMessages: [message],
      maxRequests: 0,
    }).promise;

    expect(spacing.results).toEqual([]);
    expect(punctuation.results).toEqual([]);
  });

  it("uses Unicode code points for the 2-to-100 query limits", () => {
    expect(countUnicodeCodePoints("😀a")).toBe(2);
    expect(validatePrivateMessageSearchQuery("😀a")).toMatchObject({ ok: true });
    expect(validatePrivateMessageSearchQuery("a")).toEqual({
      ok: false,
      reason: "too-short",
    });

    const maxQuery = "😀".repeat(PRIVATE_MESSAGE_SEARCH_MAX_QUERY_CODE_POINTS);
    expect(countUnicodeCodePoints(maxQuery)).toBe(PRIVATE_MESSAGE_SEARCH_MAX_QUERY_CODE_POINTS);
    expect(validatePrivateMessageSearchQuery(maxQuery)).toMatchObject({ ok: true });
    expect(validatePrivateMessageSearchQuery(`${maxQuery}a`)).toEqual({
      ok: false,
      reason: "too-long",
    });
  });

  it("does no network or decryption work for short or overlong queries", async () => {
    for (const query of ["", " ", "a", "a".repeat(101)]) {
      const decrypt = makeDecrypt();
      const fetchBootstrap = vi.fn(async () => ({ messages: [], totalPages: 1 }));
      const fetchContext = vi.fn(async () => ({
        anchorMessageId: "anchor",
        messages: [],
        hasMoreBefore: false,
        hasMoreAfter: false,
      }));

      const outcome = await searchPrivateMessages({
        chatId: CHAT_ID,
        query,
        loadedMessages: [],
        plaintextCache: new Map(),
        decrypt,
        fetchBootstrap,
        fetchContext,
      });

      expect(decrypt).not.toHaveBeenCalled();
      expect(fetchBootstrap).not.toHaveBeenCalled();
      expect(fetchContext).not.toHaveBeenCalled();
      expect(outcome.status).toBe(query.trim().length > 100 ? "invalid" : "idle");
    }
  });

  it("does not use fuzzy or token-boundary behavior", async () => {
    const message = makeMessage({ id: "m1", plaintext: "running foobar" });
    const fuzzy = await runSearch({
      query: "runing",
      loadedMessages: [message],
      maxRequests: 0,
    }).promise;
    const substring = await runSearch({
      query: "oob",
      loadedMessages: [message],
      resultTarget: 1,
    }).promise;

    expect(fuzzy.results).toEqual([]);
    expect(substring.results.map(({ id }) => id)).toEqual(["m1"]);
    expect(normalizePrivateMessageSearchText("FoO")).toBe("foo");
  });
});

describe("private message search encryption boundary", () => {
  it("passes only chat metadata and bounded counts to history/context fetchers", async () => {
    const fetchBootstrap = vi.fn<
      (input: { chatId: string; limit: number }) => Promise<PrivateMessageSearchBootstrapResponse>
    >(async () => ({
      messages: [makeMessage({ id: "m3", plaintext: "no match" })],
      totalPages: 2,
    }));
    const fetchContext = vi.fn(async ({ messageId }: { messageId: string }) => ({
      anchorMessageId: messageId,
      messages: [],
      hasMoreBefore: false,
      hasMoreAfter: false,
    }));

    await runSearch({ fetchBootstrap, fetchContext }).promise;

    expect(fetchBootstrap).toHaveBeenCalledWith({ chatId: CHAT_ID, limit: 20 });
    expect(fetchContext).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      messageId: "m3",
      before: 20,
      after: 0,
    });
    expect(Object.keys(fetchBootstrap.mock.calls[0]?.[0] ?? {}).sort()).toEqual([
      "chatId",
      "limit",
    ]);
    expect(Object.keys(fetchContext.mock.calls[0]?.[0] ?? {}).sort()).toEqual([
      "after",
      "before",
      "chatId",
      "messageId",
    ]);
  });

  it("never returns stored ciphertext or legacy plaintext when decryption fails", async () => {
    const legacyPlaintext = makeMessage({
      id: "legacy",
      plaintext: "needle",
      ciphertext: "needle",
    });
    const fetchContext = vi.fn(async () => ({
      anchorMessageId: legacyPlaintext.id,
      messages: [legacyPlaintext],
      hasMoreBefore: false,
      hasMoreAfter: false,
    }));

    const outcome = await runSearch({
      loadedMessages: [legacyPlaintext],
      fetchContext,
    }).promise;

    expect(outcome.results).toEqual([]);
    expect(outcome.status).toBe("unavailable");
  });

  it("skips corrupt ciphertext without suppressing valid matches", async () => {
    const corrupt = makeMessage({
      id: "m2",
      plaintext: "needle",
      ciphertext: "not-ciphertext",
      createdAt: new Date("2026-09-09T12:02:00.000Z"),
    });
    const valid = makeMessage({
      id: "m1",
      plaintext: "valid needle",
      createdAt: new Date("2026-09-09T12:01:00.000Z"),
    });

    const outcome = await runSearch({
      loadedMessages: [corrupt, valid],
      resultTarget: 1,
    }).promise;

    expect(outcome.status).toBe("ready");
    expect(outcome.results.map(({ id }) => id)).toEqual(["m1"]);
  });

  it("returns unavailable when history is exhausted and every eligible ciphertext fails", async () => {
    const corrupt = makeMessage({ id: "m1", plaintext: "needle", ciphertext: "broken" });
    const fetchContext = vi.fn(async () => ({
      anchorMessageId: corrupt.id,
      messages: [corrupt],
      hasMoreBefore: false,
      hasMoreAfter: false,
    }));

    const outcome = await runSearch({
      loadedMessages: [corrupt],
      fetchContext,
    }).promise;

    expect(outcome.status).toBe("unavailable");
    expect(outcome.historyExhausted).toBe(true);
  });

  it("excludes polls and non-text messages from private encrypted-text search", async () => {
    const poll = makeMessage({
      id: "poll",
      plaintext: "needle",
      isPollMessage: true,
    });
    const attachment = makeMessage({
      id: "attachment",
      plaintext: "needle",
      isTextMessage: false,
    });
    const decrypt = makeDecrypt();

    const outcome = await runSearch({
      loadedMessages: [poll, attachment],
      decrypt,
      maxRequests: 0,
    }).promise;

    expect(outcome.results).toEqual([]);
    expect(decrypt).not.toHaveBeenCalled();
  });
});

describe("private message search progressive traversal", () => {
  it("searches loaded messages first and performs no request once 20 results are found", async () => {
    const loadedMessages = Array.from({ length: 20 }, (_, index) => makeMessage({
      id: `m${String(index).padStart(2, "0")}`,
      plaintext: `needle ${index}`,
      createdAt: new Date(Date.UTC(2026, 8, 9, 12, index)),
    }));
    const fetchBootstrap = vi.fn(async () => ({ messages: [], totalPages: 1 }));
    const fetchContext = vi.fn(async () => ({
      anchorMessageId: "anchor",
      messages: [],
      hasMoreBefore: false,
      hasMoreAfter: false,
    }));

    const outcome = await runSearch({
      loadedMessages,
      fetchBootstrap,
      fetchContext,
    }).promise;

    expect(outcome.results).toHaveLength(20);
    expect(fetchBootstrap).not.toHaveBeenCalled();
    expect(fetchContext).not.toHaveBeenCalled();
  });

  it("progresses backward with context, deduplicates overlap, and stops at history end", async () => {
    const m3 = makeMessage({
      id: "m3",
      plaintext: "latest no match",
      createdAt: new Date("2026-09-09T12:03:00.000Z"),
    });
    const m2 = makeMessage({
      id: "m2",
      plaintext: "older needle",
      createdAt: new Date("2026-09-09T12:02:00.000Z"),
    });
    const m1 = makeMessage({
      id: "m1",
      plaintext: "oldest needle",
      createdAt: new Date("2026-09-09T12:01:00.000Z"),
    });
    const fetchContext = vi.fn(async () => ({
      anchorMessageId: m3.id,
      messages: [m1, m2, m3],
      hasMoreBefore: false,
      hasMoreAfter: false,
    }));
    const decrypt = makeDecrypt();

    const outcome = await runSearch({
      loadedMessages: [m3],
      fetchContext,
      decrypt,
    }).promise;

    expect(fetchContext).toHaveBeenCalledTimes(1);
    expect(outcome.results.map(({ id }) => id)).toEqual(["m2", "m1"]);
    expect(outcome.historyExhausted).toBe(true);
    expect(decrypt).toHaveBeenCalledTimes(3);
  });

  it("enforces the five-request traversal cap", async () => {
    const loaded = makeMessage({
      id: "m100",
      plaintext: "no match",
      createdAt: new Date("2026-09-09T13:40:00.000Z"),
    });
    let next = 99;
    const fetchContext = vi.fn(async ({ messageId }: { messageId: string }) => {
      const older = makeMessage({
        id: `m${next}`,
        plaintext: `still no match ${next}`,
        createdAt: new Date(Date.UTC(2026, 8, 9, 12, next)),
      });
      next -= 1;
      return {
        anchorMessageId: messageId,
        messages: [older],
        hasMoreBefore: true,
        hasMoreAfter: false,
      };
    });

    const outcome = await runSearch({
      loadedMessages: [loaded],
      fetchContext,
    }).promise;

    expect(fetchContext).toHaveBeenCalledTimes(PRIVATE_MESSAGE_SEARCH_MAX_REQUESTS);
    expect(outcome.requestCount).toBe(PRIVATE_MESSAGE_SEARCH_MAX_REQUESTS);
    expect(outcome.workCapReached).toBe(true);
    expect(outcome.historyExhausted).toBe(false);
  });

  it("enforces the 100-new-decryption cap", async () => {
    const loadedMessages = Array.from({ length: 101 }, (_, index) => makeMessage({
      id: `m${String(index).padStart(3, "0")}`,
      plaintext: `not a match ${index}`,
      createdAt: new Date(Date.UTC(2026, 8, 9, 12, 0, index)),
    }));
    const decrypt = makeDecrypt();

    const outcome = await runSearch({
      loadedMessages,
      decrypt,
      maxRequests: 0,
    }).promise;

    expect(outcome.decryptionCount).toBe(PRIVATE_MESSAGE_SEARCH_MAX_DECRYPTIONS);
    expect(decrypt).toHaveBeenCalledTimes(PRIVATE_MESSAGE_SEARCH_MAX_DECRYPTIONS);
    expect(outcome.workCapReached).toBe(true);
  });

  it("reuses plaintext cached for the exact message ciphertext", async () => {
    const message = makeMessage({ id: "m1", plaintext: "needle once" });
    const plaintextCache = new Map<string, PrivateMessageSearchCacheEntry>();
    const decrypt = makeDecrypt();

    const first = await searchPrivateMessages({
      chatId: CHAT_ID,
      query: "needle",
      loadedMessages: [message],
      plaintextCache,
      decrypt,
      fetchBootstrap: noBootstrap,
      fetchContext: exhaustedContext,
      resultTarget: 1,
    });
    const second = await searchPrivateMessages({
      chatId: CHAT_ID,
      query: "once",
      loadedMessages: [message],
      plaintextCache,
      decrypt,
      fetchBootstrap: noBootstrap,
      fetchContext: exhaustedContext,
      resultTarget: 1,
    });

    expect(first.decryptionCount).toBe(1);
    expect(second.decryptionCount).toBe(0);
    expect(decrypt).toHaveBeenCalledTimes(1);
  });
});

describe("private message search live reconciliation", () => {
  it("invalidates cached plaintext when an edit replaces ciphertext", async () => {
    const message = makeMessage({ id: "m1", plaintext: "old needle" });
    const plaintextCache = new Map<string, PrivateMessageSearchCacheEntry>([
      ["m1", {
        ciphertext: "enc:old needle",
        status: "ok",
        plaintext: "old needle",
        normalizedPlaintext: "old needle",
      }],
    ]);
    const editedCiphertexts = new Map([["m1", "enc:new wording"]]);
    const decrypt = makeDecrypt();
    const fetchContext = vi.fn(async () => ({
      anchorMessageId: message.id,
      messages: [message],
      hasMoreBefore: false,
      hasMoreAfter: false,
    }));

    const outcome = await searchPrivateMessages({
      chatId: CHAT_ID,
      query: "needle",
      loadedMessages: [message],
      plaintextCache,
      decrypt,
      fetchBootstrap: noBootstrap,
      fetchContext,
      getLiveState: () => ({ editedCiphertexts }),
    });

    expect(outcome.results).toEqual([]);
    expect(decrypt).toHaveBeenCalledWith("enc:new wording");
    expect(plaintextCache.get("m1")?.ciphertext).toBe("enc:new wording");
  });

  it("tombstones deleted messages so overlapping responses cannot resurrect them", async () => {
    const deleted = makeMessage({ id: "m2", plaintext: "needle deleted" });
    const anchor = makeMessage({
      id: "m3",
      plaintext: "no match",
      createdAt: new Date("2026-09-09T12:03:00.000Z"),
    });
    const tombstones = new Set([deleted.id]);
    const fetchContext = vi.fn(async () => ({
      anchorMessageId: anchor.id,
      messages: [deleted, anchor],
      hasMoreBefore: false,
      hasMoreAfter: false,
    }));

    const outcome = await runSearch({
      loadedMessages: [anchor],
      fetchContext,
      getLiveState: () => ({ tombstones }),
    }).promise;

    expect(outcome.results).toEqual([]);
  });

  it("includes a new socket message and preserves newest-first id ordering", async () => {
    const older = makeMessage({
      id: "a",
      plaintext: "needle older",
      createdAt: new Date("2026-09-09T12:00:00.000Z"),
    });
    const liveA = makeMessage({
      id: "b",
      plaintext: "needle live b",
      createdAt: new Date("2026-09-09T12:05:00.000Z"),
    });
    const liveB = makeMessage({
      id: "c",
      plaintext: "needle live c",
      createdAt: new Date("2026-09-09T12:05:00.000Z"),
    });
    const newMessages = new Map([
      [liveA.id, liveA],
      [liveB.id, liveB],
    ]);

    const outcome = await runSearch({
      loadedMessages: [older],
      getLiveState: () => ({ newMessages }),
      resultTarget: 3,
    }).promise;

    expect(outcome.results.map(({ id }) => id)).toEqual(["c", "b", "a"]);
  });

  it("does not publish a superseded operation after an in-flight fetch completes", async () => {
    let resolveBootstrap: ((value: { messages: Message[]; totalPages: number }) => void) | undefined;
    let markFetchStarted: (() => void) | undefined;
    const bootstrapPromise = new Promise<{ messages: Message[]; totalPages: number }>((resolve) => {
      resolveBootstrap = resolve;
    });
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    let current = true;
    const fetchBootstrap = vi.fn(() => {
      markFetchStarted?.();
      return bootstrapPromise;
    });

    const searchPromise = runSearch({
      fetchBootstrap,
      isCurrent: () => current,
    }).promise;

    await fetchStarted;
    expect(fetchBootstrap).toHaveBeenCalledTimes(1);
    current = false;
    resolveBootstrap?.({ messages: [], totalPages: 1 });

    const outcome = await searchPromise;
    expect(outcome.status).toBe("cancelled");
  });
});
