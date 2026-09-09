import { Buffer } from "node:buffer";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  chatFindFirst: vi.fn(),
  messageCount: vi.fn(),
  messageFindFirst: vi.fn(),
  messageFindMany: vi.fn(),
}));

const routeMocks = vi.hoisted(() => ({
  verifyToken: vi.fn((req: Request, res: Response, next: NextFunction) => {
    if (req.get("authorization") !== "Bearer actor") {
      res.status(401).json({ success: false, message: "Authentication is required" });
      return;
    }
    (req as Request & { user: { id: string } }).user = {
      id: "clxactor00000000000000001",
    };
    next();
  }),
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    chat: {
      findFirst: prismaMocks.chatFindFirst,
    },
    message: {
      count: prismaMocks.messageCount,
      findFirst: prismaMocks.messageFindFirst,
      findMany: prismaMocks.messageFindMany,
    },
  },
}));

vi.mock("../src/middlewares/verify-token.middleware.js", () => ({
  verifyToken: routeMocks.verifyToken,
}));

import { errorMiddleware } from "../src/middlewares/error.middleware.js";
import { clearBackendRateLimitsForTests } from "../src/security/rate-limit.js";
import {
  createGroupMessageSearcher,
  decodeMessageSearchCursor,
  encodeMessageSearchCursor,
  escapeMessageSearchPattern,
} from "../src/modules/read-queries/application/search-group-messages.js";
import type { MessageReadRepository } from "../src/modules/read-queries/contracts/message-read.repository.js";
import type {
  MessageSearchRecord,
  MessageSearchResultView,
} from "../src/modules/read-queries/contracts/read-query.types.js";
import {
  groupMessageSearchArguments,
  messageSearchSelect,
} from "../src/modules/read-queries/infrastructure/prisma-message-read.repository.js";
import messageRouter from "../src/routes/message.router.js";
import {
  DEFAULT_MESSAGE_SEARCH_LIMIT,
  MAX_MESSAGE_SEARCH_CURSOR_LENGTH,
  MAX_MESSAGE_SEARCH_LIMIT,
  MAX_MESSAGE_SEARCH_QUERY_LENGTH,
  MIN_MESSAGE_SEARCH_QUERY_LENGTH,
  messageSearchParamsSchema,
  messageSearchQuerySchema,
} from "../src/schemas/message.schema.js";

const ACTOR_ID = "clxactor00000000000000001";
const CHAT_ID = "clxchat000000000000000001";
const OTHER_CHAT_ID = "clxotherchat0000000000001";
const FIRST_MESSAGE_ID = "clxmessage000000000000003";
const SECOND_MESSAGE_ID = "clxmessage000000000000002";
const THIRD_MESSAGE_ID = "clxmessage000000000000001";
const CREATED_AT = new Date("2026-09-09T12:00:00.000Z");

const authorizedGroupChat = {
  id: CHAT_ID,
  isGroupChat: true,
  adminId: ACTOR_ID,
  avatarCloudinaryPublicId: null,
  ChatMembers: [{ userId: ACTOR_ID }],
};

const searchMessage = (
  id: string,
  textMessageContent: string | null = "Current searchable text",
  chatId = CHAT_ID,
  createdAt = CREATED_AT,
): MessageSearchRecord => ({
  id,
  chatId,
  textMessageContent,
  isEdited: true,
  createdAt,
  sender: {
    id: ACTOR_ID,
    username: "actor",
    avatar: "avatar.png",
  },
});

const app = express();
app.use("/api/v1/message", messageRouter);
app.use(errorMiddleware);

describe("message search route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearBackendRateLimitsForTests();
    prismaMocks.chatFindFirst.mockResolvedValue(authorizedGroupChat);
    prismaMocks.messageFindMany.mockResolvedValue([]);
  });

  it("rejects an unauthenticated request before authorization and search", async () => {
    const response = await request(app)
      .get(`/api/v1/message/${CHAT_ID}/search`)
      .query({ q: "hello" });

    expect(response.status).toBe(401);
    expect(prismaMocks.chatFindFirst).not.toHaveBeenCalled();
    expect(prismaMocks.messageFindMany).not.toHaveBeenCalled();
  });

  it("lets a current group member search and does not invoke legacy history", async () => {
    prismaMocks.messageFindMany.mockResolvedValue([searchMessage(FIRST_MESSAGE_ID)]);

    const response = await request(app)
      .get(`/api/v1/message/${CHAT_ID}/search`)
      .set("Authorization", "Bearer actor")
      .query({ q: "  searchable  " });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      messages: [{
        id: FIRST_MESSAGE_ID,
        chatId: CHAT_ID,
        textMessageContent: "Current searchable text",
      }],
      nextCursor: null,
      hasMore: false,
    });
    expect(prismaMocks.messageFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        chatId: CHAT_ID,
        textMessageContent: expect.objectContaining({ contains: "searchable" }),
      }),
      select: messageSearchSelect,
      take: 21,
    }));
    expect(prismaMocks.messageCount).not.toHaveBeenCalled();
  });

  it.each([
    ["nonexistent chat", null],
    ["non-member", null],
    ["private chat member", { ...authorizedGroupChat, isGroupChat: false }],
  ])("returns the same generic 404 for a %s", async (_label, authorizedChat) => {
    prismaMocks.chatFindFirst.mockResolvedValueOnce(authorizedChat);

    const response = await request(app)
      .get(`/api/v1/message/${CHAT_ID}/search`)
      .set("Authorization", "Bearer actor")
      .query({ q: "hello" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, message: "Chat not found" });
    expect(prismaMocks.messageFindMany).not.toHaveBeenCalled();
  });

  it.each([
    ["missing q", {}],
    ["empty q", { q: "" }],
    ["whitespace-only q", { q: "   " }],
    ["one-character q", { q: "a" }],
    ["101-character q", { q: "a".repeat(101) }],
    ["unknown query key", { q: "ok", extra: "value" }],
    ["zero limit", { q: "ok", limit: "0" }],
    ["over-maximum limit", { q: "ok", limit: "21" }],
    ["negative limit", { q: "ok", limit: "-1" }],
    ["fractional limit", { q: "ok", limit: "1.5" }],
    ["malformed limit", { q: "ok", limit: "many" }],
    ["oversized cursor", { q: "ok", cursor: "a".repeat(MAX_MESSAGE_SEARCH_CURSOR_LENGTH + 1) }],
  ])("rejects %s before chat authorization", async (_label, query) => {
    const response = await request(app)
      .get(`/api/v1/message/${CHAT_ID}/search`)
      .set("Authorization", "Bearer actor")
      .query(query);

    expect(response.status).toBe(400);
    expect(prismaMocks.chatFindFirst).not.toHaveBeenCalled();
    expect(prismaMocks.messageFindMany).not.toHaveBeenCalled();
  });

  it("rejects a malformed cursor without exposing its parsing error", async () => {
    const response = await request(app)
      .get(`/api/v1/message/${CHAT_ID}/search`)
      .set("Authorization", "Bearer actor")
      .query({ q: "ok", cursor: "not-a-valid-cursor" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, message: "Invalid search cursor" });
    expect(prismaMocks.messageFindMany).not.toHaveBeenCalled();
  });

  it("rejects a malformed chat ID before authorization", async () => {
    const response = await request(app)
      .get("/api/v1/message/not-a-cuid/search")
      .set("Authorization", "Bearer actor")
      .query({ q: "ok" });

    expect(response.status).toBe(400);
    expect(prismaMocks.chatFindFirst).not.toHaveBeenCalled();
    expect(prismaMocks.messageFindMany).not.toHaveBeenCalled();
  });
});

describe("message search validation", () => {
  it("accepts and transforms the exact query boundaries", () => {
    expect(messageSearchParamsSchema.parse({ chatId: CHAT_ID })).toEqual({ chatId: CHAT_ID });
    expect(messageSearchQuerySchema.parse({ q: "  ok  " })).toEqual({
      q: "ok",
      limit: DEFAULT_MESSAGE_SEARCH_LIMIT,
    });
    expect(messageSearchQuerySchema.parse({
      q: "a".repeat(MAX_MESSAGE_SEARCH_QUERY_LENGTH),
      limit: "1",
    })).toMatchObject({ limit: 1 });
    expect(messageSearchQuerySchema.parse({ q: "ok", limit: String(MAX_MESSAGE_SEARCH_LIMIT) }))
      .toMatchObject({ limit: MAX_MESSAGE_SEARCH_LIMIT });
    expect(MIN_MESSAGE_SEARCH_QUERY_LENGTH).toBe(2);
  });

  it("preserves internal whitespace while trimming the query boundary", () => {
    expect(messageSearchQuerySchema.parse({ q: "  two   words  " }).q).toBe("two   words");
  });
});

describe("message search cursor", () => {
  const encodedPayload = (payload: unknown) =>
    Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

  it("round-trips a supported opaque versioned cursor", () => {
    const cursor = encodeMessageSearchCursor({ createdAt: CREATED_AT, id: FIRST_MESSAGE_ID });

    expect(cursor).not.toContain("{");
    expect(decodeMessageSearchCursor(cursor)).toEqual({
      createdAt: CREATED_AT,
      id: FIRST_MESSAGE_ID,
    });
  });

  it.each([
    ["malformed base64url", "not+base64"],
    ["malformed JSON", Buffer.from("not-json", "utf8").toString("base64url")],
    ["unsupported version", encodedPayload({ v: 2, createdAt: CREATED_AT.toISOString(), id: FIRST_MESSAGE_ID })],
    ["invalid timestamp", encodedPayload({ v: 1, createdAt: "not-a-date", id: FIRST_MESSAGE_ID })],
    ["invalid message id", encodedPayload({ v: 1, createdAt: CREATED_AT.toISOString(), id: "message-id" })],
    ["unexpected payload property", encodedPayload({
      v: 1,
      createdAt: CREATED_AT.toISOString(),
      id: FIRST_MESSAGE_ID,
      chatId: CHAT_ID,
    })],
  ])("normalizes %s to one safe 400 error", (_label, cursor) => {
    expect(() => decodeMessageSearchCursor(cursor)).toThrowError("Invalid search cursor");
    try {
      decodeMessageSearchCursor(cursor);
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 400, message: "Invalid search cursor" });
    }
  });
});

describe("message search Prisma query", () => {
  it("is group-only, current-member-bound, text-only, deterministic, and cursor-based", () => {
    const argumentsWithCursor = groupMessageSearchArguments({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      escapedQuery: "needle",
      cursor: { createdAt: CREATED_AT, id: FIRST_MESSAGE_ID },
      take: 21,
    });

    expect(argumentsWithCursor).toEqual({
      where: {
        chatId: CHAT_ID,
        chat: {
          isGroupChat: true,
          ChatMembers: { some: { userId: ACTOR_ID } },
        },
        isTextMessage: true,
        isPollMessage: false,
        textMessageContent: {
          not: null,
          contains: "needle",
          mode: "insensitive",
        },
        OR: [
          { createdAt: { lt: CREATED_AT } },
          { createdAt: CREATED_AT, id: { lt: FIRST_MESSAGE_ID } },
        ],
      },
      select: {
        id: true,
        chatId: true,
        textMessageContent: true,
        isEdited: true,
        createdAt: true,
        sender: {
          select: {
            id: true,
            username: true,
            avatar: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
    });
    expect(argumentsWithCursor).not.toHaveProperty("skip");
    expect(argumentsWithCursor.select).not.toHaveProperty("attachments");
    expect(argumentsWithCursor.select).not.toHaveProperty("poll");
    expect(argumentsWithCursor.select).not.toHaveProperty("reactions");
    expect(argumentsWithCursor.select).not.toHaveProperty("replyToMessage");
    expect(argumentsWithCursor.select).not.toHaveProperty("audioUrl");
    expect(argumentsWithCursor.select).not.toHaveProperty("url");
  });

  it("excludes nonmatching, null, non-text, and poll rows through the database predicate", () => {
    const query = groupMessageSearchArguments({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      escapedQuery: "edited text",
      take: 21,
    });

    expect(query.where).toMatchObject({
      isTextMessage: true,
      isPollMessage: false,
      textMessageContent: {
        not: null,
        contains: "edited text",
        mode: "insensitive",
      },
    });
  });

  it.each([
    ["percent", "%", "\\%"],
    ["underscore", "_", "\\_"],
    ["backslash", "\\", "\\\\"],
    ["combined literal pattern", "50%_\\done", "50\\%\\_\\\\done"],
  ])("escapes literal %s matching without changing other content", (_label, query, escaped) => {
    expect(escapeMessageSearchPattern(query)).toBe(escaped);
    expect(groupMessageSearchArguments({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      escapedQuery: escapeMessageSearchPattern(query),
      take: 21,
    }).where.textMessageContent).toMatchObject({
      contains: escaped,
      mode: "insensitive",
    });
  });
});

describe("message search application", () => {
  const repository = {
    searchGroupMessages: vi.fn(),
  } as unknown as MessageReadRepository;
  const authorizeChat = vi.fn();
  const search = createGroupMessageSearcher({ repository, authorizeChat });

  beforeEach(() => {
    vi.clearAllMocks();
    authorizeChat.mockResolvedValue(authorizedGroupChat);
    vi.mocked(repository.searchGroupMessages).mockResolvedValue([]);
  });

  it("fetches a sentinel and returns an opaque cursor from the final visible row", async () => {
    const first = searchMessage(FIRST_MESSAGE_ID);
    const second = searchMessage(SECOND_MESSAGE_ID);
    const sentinel = searchMessage(THIRD_MESSAGE_ID);
    vi.mocked(repository.searchGroupMessages).mockResolvedValue([first, second, sentinel]);

    const result = await search({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      q: "100% ready",
      limit: 2,
    });

    expect(authorizeChat).toHaveBeenCalledWith(ACTOR_ID, CHAT_ID);
    expect(repository.searchGroupMessages).toHaveBeenCalledWith({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      escapedQuery: "100\\% ready",
      take: 3,
    });
    expect(result.messages).toEqual([first, second]);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).not.toBeNull();
    expect(decodeMessageSearchCursor(result.nextCursor!)).toEqual({
      createdAt: second.createdAt,
      id: second.id,
    });
  });

  it("returns the empty and final-page contracts without a cursor", async () => {
    await expect(search({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      q: "none",
      limit: 20,
    })).resolves.toEqual({ messages: [], nextCursor: null, hasMore: false });

    const only = searchMessage(FIRST_MESSAGE_ID);
    vi.mocked(repository.searchGroupMessages).mockResolvedValueOnce([only]);
    await expect(search({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      q: "current",
      limit: 20,
    })).resolves.toEqual({ messages: [only], nextCursor: null, hasMore: false });
  });

  it("decodes a second-page cursor before calling the repository", async () => {
    const cursor = encodeMessageSearchCursor({ createdAt: CREATED_AT, id: FIRST_MESSAGE_ID });

    await search({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      q: "current",
      limit: 20,
      cursor,
    });

    expect(repository.searchGroupMessages).toHaveBeenCalledWith(expect.objectContaining({
      cursor: { createdAt: CREATED_AT, id: FIRST_MESSAGE_ID },
    }));
  });

  it("does not search private chats and uses the generic inaccessible-chat error", async () => {
    authorizeChat.mockResolvedValueOnce({ ...authorizedGroupChat, isGroupChat: false });

    await expect(search({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      q: "ciphertext",
      limit: 20,
    })).rejects.toMatchObject({ statusCode: 404, message: "Chat not found" });
    expect(repository.searchGroupMessages).not.toHaveBeenCalled();
  });

  it("fails closed with no content when membership disappears after authorization", async () => {
    vi.mocked(repository.searchGroupMessages).mockResolvedValueOnce([]);

    await expect(search({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      q: "current",
      limit: 20,
    })).resolves.toEqual({ messages: [], nextCursor: null, hasMore: false });
  });

  it.each([
    ["cross-chat row", searchMessage(FIRST_MESSAGE_ID, "secret", OTHER_CHAT_ID)],
    ["null text row", searchMessage(FIRST_MESSAGE_ID, null)],
  ])("fails closed on an impossible %s", async (_label, unsafeRow) => {
    vi.mocked(repository.searchGroupMessages).mockResolvedValueOnce([unsafeRow]);

    await expect(search({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      q: "secret",
      limit: 20,
    })).rejects.toMatchObject({ statusCode: 404, message: "Chat not found" });
  });

  it("returns only the current edited text supplied by the scoped repository", async () => {
    const edited = searchMessage(FIRST_MESSAGE_ID, "Current edited text");
    vi.mocked(repository.searchGroupMessages).mockResolvedValueOnce([edited]);

    const result = await search({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      q: "edited",
      limit: 20,
    });

    expect(result.messages[0]).toMatchObject({
      isEdited: true,
      textMessageContent: "Current edited text",
    });
    expect(result.messages[0]?.textMessageContent).not.toContain("Previous");
  });
});
