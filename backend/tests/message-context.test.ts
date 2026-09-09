import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  messageCount: vi.fn(),
  messageFindFirst: vi.fn(),
  messageFindMany: vi.fn(),
}));

const routeMocks = vi.hoisted(() => ({
  verifyToken: vi.fn((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { id: string } }).user = { id: "clxactor00000000000000001" };
    next();
  }),
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
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

import { createMessageContextReader } from "../src/modules/read-queries/application/get-message-context.js";
import type { MessageReadRepository } from "../src/modules/read-queries/contracts/message-read.repository.js";
import type { MessageReadView } from "../src/modules/read-queries/contracts/read-query.types.js";
import {
  messageByIdArguments,
  messageListArguments,
  messagesAfterArguments,
  messagesBeforeArguments,
} from "../src/modules/read-queries/infrastructure/prisma-message-read.repository.js";
import messageRouter from "../src/routes/message.router.js";
import {
  DEFAULT_MESSAGE_CONTEXT_MESSAGES_PER_SIDE,
  MAX_MESSAGE_CONTEXT_MESSAGES_PER_SIDE,
  messageContextParamsSchema,
  messageContextQuerySchema,
} from "../src/schemas/message.schema.js";
import { errorMiddleware } from "../src/middlewares/error.middleware.js";
import { CustomError } from "../src/utils/error.utils.js";

const ACTOR_ID = "clxactor00000000000000001";
const CHAT_ID = "clxchat000000000000000001";
const OTHER_CHAT_ID = "clxotherchat0000000000001";
const ANCHOR_ID = "clxmessage000000000000005";
const ANCHOR_CREATED_AT = new Date("2026-09-08T12:00:00.000Z");

const message = (
  id: string,
  createdAt = ANCHOR_CREATED_AT,
  chatId = CHAT_ID,
) => ({ id, chatId, createdAt }) as unknown as MessageReadView;

const authorizedAnchor = {
  id: ANCHOR_ID,
  chatId: CHAT_ID,
  createdAt: ANCHOR_CREATED_AT,
  senderId: ACTOR_ID,
  pollId: null,
  audioPublicId: null,
  attachments: [],
};

const app = express();
app.use("/api/v1/message", messageRouter);
app.use(errorMiddleware);

describe("message context route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets an authenticated member load a bounded chronological context", async () => {
    const older = message("clxmessage000000000000004");
    const anchor = message(ANCHOR_ID);
    const newer = message("clxmessage000000000000006");
    prismaMocks.messageFindFirst
      .mockResolvedValueOnce(authorizedAnchor)
      .mockResolvedValueOnce(anchor);
    prismaMocks.messageFindMany
      .mockResolvedValueOnce([older])
      .mockResolvedValueOnce([newer]);

    const response = await request(app)
      .get(`/api/v1/message/${CHAT_ID}/${ANCHOR_ID}/context`)
      .query({ before: "1", after: "1" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      anchorMessageId: ANCHOR_ID,
      messages: [
        { id: older.id },
        { id: ANCHOR_ID },
        { id: newer.id },
      ],
      hasMoreBefore: false,
      hasMoreAfter: false,
    });
    expect(routeMocks.verifyToken).toHaveBeenCalledOnce();
    expect(prismaMocks.messageFindFirst).toHaveBeenNthCalledWith(1, {
      where: {
        id: ANCHOR_ID,
        chatId: CHAT_ID,
        chat: {
          ChatMembers: {
            some: {
              userId: ACTOR_ID,
            },
          },
        },
      },
      select: expect.objectContaining({
        id: true,
        chatId: true,
      }),
    });
    expect(prismaMocks.messageFindFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        id: ANCHOR_ID,
        chatId: CHAT_ID,
        chat: {
          ChatMembers: {
            some: {
              userId: ACTOR_ID,
            },
          },
        },
      },
    }));
    expect(prismaMocks.messageFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        chatId: CHAT_ID,
        chat: {
          ChatMembers: {
            some: {
              userId: ACTOR_ID,
            },
          },
        },
      }),
    }));
    expect(prismaMocks.messageFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        chatId: CHAT_ID,
        chat: {
          ChatMembers: {
            some: {
              userId: ACTOR_ID,
            },
          },
        },
      }),
    }));
    expect(prismaMocks.messageCount).not.toHaveBeenCalled();
  });

  it.each(["non-member", "nonexistent anchor"])(
    "returns the same 404 for a %s before context reads",
    async () => {
      prismaMocks.messageFindFirst.mockResolvedValueOnce(null);

      const response = await request(app)
        .get(`/api/v1/message/${CHAT_ID}/${ANCHOR_ID}/context`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ success: false, message: "Message not found" });
      expect(prismaMocks.messageFindFirst).toHaveBeenCalledOnce();
      expect(prismaMocks.messageFindMany).not.toHaveBeenCalled();
      expect(prismaMocks.messageCount).not.toHaveBeenCalled();
    },
  );

  it("cannot use a supplied chat ID to access an anchor in another chat", async () => {
    prismaMocks.messageFindFirst.mockResolvedValueOnce(null);

    const response = await request(app)
      .get(`/api/v1/message/${CHAT_ID}/${ANCHOR_ID}/context`);

    expect(response.status).toBe(404);
    expect(prismaMocks.messageFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: ANCHOR_ID,
        chatId: CHAT_ID,
      }),
    }));
    expect(prismaMocks.messageFindMany).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed before", CHAT_ID, ANCHOR_ID, { before: "many" }],
    ["fractional after", CHAT_ID, ANCHOR_ID, { after: "1.5" }],
    ["negative before", CHAT_ID, ANCHOR_ID, { before: "-1" }],
    ["over-maximum after", CHAT_ID, ANCHOR_ID, { after: "51" }],
    ["malformed chat ID", "not-a-cuid", ANCHOR_ID, {}],
    ["malformed message ID", CHAT_ID, "not-a-cuid", {}],
  ])("rejects %s before authorization or Prisma reads", async (_label, chatId, messageId, query) => {
    const response = await request(app)
      .get(`/api/v1/message/${chatId}/${messageId}/context`)
      .query(query);

    expect(response.status).toBe(400);
    expect(prismaMocks.messageFindFirst).not.toHaveBeenCalled();
    expect(prismaMocks.messageFindMany).not.toHaveBeenCalled();
    expect(prismaMocks.messageCount).not.toHaveBeenCalled();
  });
});

describe("message context validation", () => {
  it("applies conservative defaults and accepts both zero and the maximum", () => {
    expect(messageContextQuerySchema.parse({})).toEqual({
      before: DEFAULT_MESSAGE_CONTEXT_MESSAGES_PER_SIDE,
      after: DEFAULT_MESSAGE_CONTEXT_MESSAGES_PER_SIDE,
    });
    expect(messageContextQuerySchema.parse({
      before: "0",
      after: String(MAX_MESSAGE_CONTEXT_MESSAGES_PER_SIDE),
    })).toEqual({ before: 0, after: MAX_MESSAGE_CONTEXT_MESSAGES_PER_SIDE });
    expect(messageContextQuerySchema.parse({
      before: "50",
      after: "50",
    })).toEqual({ before: 50, after: 50 });
    expect(() => messageContextQuerySchema.parse({
      before: "51",
      after: "50",
    })).toThrow();
  });

  it("accepts only CUID chat and message parameters", () => {
    expect(messageContextParamsSchema.parse({
      chatId: CHAT_ID,
      messageId: ANCHOR_ID,
    })).toEqual({ chatId: CHAT_ID, messageId: ANCHOR_ID });
    expect(() => messageContextParamsSchema.parse({
      chatId: CHAT_ID,
      messageId: "message-id",
    })).toThrow();
  });
});

describe("message context application", () => {
  const repository = {
    countMessages: vi.fn(),
    findMessage: vi.fn(),
    listMessages: vi.fn(),
    listMessagesAfter: vi.fn(),
    listMessagesBefore: vi.fn(),
  } as unknown as MessageReadRepository;
  const authorizeMessage = vi.fn();
  const readContext = createMessageContextReader({ repository, authorizeMessage });

  beforeEach(() => {
    vi.clearAllMocks();
    authorizeMessage.mockResolvedValue(authorizedAnchor);
    vi.mocked(repository.findMessage).mockResolvedValue(message(ANCHOR_ID));
    vi.mocked(repository.listMessagesBefore).mockResolvedValue([]);
    vi.mocked(repository.listMessagesAfter).mockResolvedValue([]);
  });

  it("uses limit plus one, removes sentinels, and returns chronological rows with one anchor", async () => {
    const beforeRows = [
      message("clxmessage000000000000004"),
      message("clxmessage000000000000003"),
      message("clxmessage000000000000002"),
    ];
    const afterRows = [
      message("clxmessage000000000000006"),
      message("clxmessage000000000000007"),
      message("clxmessage000000000000008"),
    ];
    vi.mocked(repository.listMessagesBefore).mockResolvedValue(beforeRows);
    vi.mocked(repository.listMessagesAfter).mockResolvedValue(afterRows);

    const result = await readContext({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      messageId: ANCHOR_ID,
      before: 2,
      after: 2,
    });

    expect(authorizeMessage).toHaveBeenCalledWith(ACTOR_ID, CHAT_ID, ANCHOR_ID);
    expect(repository.listMessagesBefore).toHaveBeenCalledWith({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      messageId: ANCHOR_ID,
      anchorCreatedAt: ANCHOR_CREATED_AT,
      take: 3,
    });
    expect(repository.listMessagesAfter).toHaveBeenCalledWith({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      messageId: ANCHOR_ID,
      anchorCreatedAt: ANCHOR_CREATED_AT,
      take: 3,
    });
    expect(result.messages.map(({ id }) => id)).toEqual([
      "clxmessage000000000000003",
      "clxmessage000000000000004",
      ANCHOR_ID,
      "clxmessage000000000000006",
      "clxmessage000000000000007",
    ]);
    expect(result.messages.filter(({ id }) => id === ANCHOR_ID)).toHaveLength(1);
    expect(result).toMatchObject({ hasMoreBefore: true, hasMoreAfter: true });
    expect(repository.countMessages).not.toHaveBeenCalled();
  });

  it("reports conversation boundaries without dropping available rows", async () => {
    const older = message("clxmessage000000000000004");
    const newer = message("clxmessage000000000000006");
    vi.mocked(repository.listMessagesBefore).mockResolvedValue([older]);
    vi.mocked(repository.listMessagesAfter).mockResolvedValue([newer]);

    const result = await readContext({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      messageId: ANCHOR_ID,
      before: 2,
      after: 2,
    });

    expect(result.messages.map(({ id }) => id)).toEqual([older.id, ANCHOR_ID, newer.id]);
    expect(result).toMatchObject({ hasMoreBefore: false, hasMoreAfter: false });
  });

  it.each(["non-member", "nonexistent anchor"])(
    "does not query context when authorization reports a %s",
    async () => {
      const authorizationError = new CustomError("Message not found", 404);
      authorizeMessage.mockRejectedValueOnce(authorizationError);

      await expect(readContext({
        actorUserId: ACTOR_ID,
        chatId: CHAT_ID,
        messageId: ANCHOR_ID,
        before: 20,
        after: 20,
      })).rejects.toBe(authorizationError);
      expect(repository.findMessage).not.toHaveBeenCalled();
      expect(repository.listMessagesBefore).not.toHaveBeenCalled();
      expect(repository.listMessagesAfter).not.toHaveBeenCalled();
    },
  );

  it("fails closed if a repository returns a row from another chat", async () => {
    vi.mocked(repository.listMessagesAfter).mockResolvedValue([
      message("clxmessage000000000000002", ANCHOR_CREATED_AT, OTHER_CHAT_ID),
    ]);

    await expect(readContext({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      messageId: ANCHOR_ID,
      before: 20,
      after: 20,
    })).rejects.toMatchObject({ statusCode: 404, message: "Message not found" });
  });

  it("fails closed if membership disappears after initial authorization", async () => {
    vi.mocked(repository.findMessage).mockResolvedValue(null);

    await expect(readContext({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      messageId: ANCHOR_ID,
      before: 20,
      after: 20,
    })).rejects.toMatchObject({ statusCode: 404, message: "Message not found" });
    expect(repository.findMessage).toHaveBeenCalledWith({
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      messageId: ANCHOR_ID,
    });
    expect(repository.listMessagesBefore).not.toHaveBeenCalled();
    expect(repository.listMessagesAfter).not.toHaveBeenCalled();
  });
});

describe("message context Prisma queries", () => {
  it("binds the authorized chat and composite anchor into every context query", () => {
    const input = {
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      messageId: ANCHOR_ID,
      anchorCreatedAt: ANCHOR_CREATED_AT,
      take: 21,
    };

    expect(messageByIdArguments(input)).toMatchObject({
      where: {
        id: ANCHOR_ID,
        chatId: CHAT_ID,
        chat: {
          ChatMembers: {
            some: { userId: ACTOR_ID },
          },
        },
      },
    });
    expect(messagesBeforeArguments(input)).toMatchObject({
      where: {
        chatId: CHAT_ID,
        chat: {
          ChatMembers: {
            some: { userId: ACTOR_ID },
          },
        },
        OR: [
          { createdAt: { lt: ANCHOR_CREATED_AT } },
          { createdAt: ANCHOR_CREATED_AT, id: { lt: ANCHOR_ID } },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
    });
    expect(messagesAfterArguments(input)).toMatchObject({
      where: {
        chatId: CHAT_ID,
        chat: {
          ChatMembers: {
            some: { userId: ACTOR_ID },
          },
        },
        OR: [
          { createdAt: { gt: ANCHOR_CREATED_AT } },
          { createdAt: ANCHOR_CREATED_AT, id: { gt: ANCHOR_ID } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 21,
    });
  });

  it("reuses the history public projection without offset pagination", () => {
    const contextInput = {
      actorUserId: ACTOR_ID,
      chatId: CHAT_ID,
      messageId: ANCHOR_ID,
      anchorCreatedAt: ANCHOR_CREATED_AT,
      take: 21,
    };
    const historyArguments = messageListArguments({ chatId: CHAT_ID, skip: 0, take: 20 });

    for (const contextArguments of [
      messageByIdArguments(contextInput),
      messagesBeforeArguments(contextInput),
      messagesAfterArguments(contextInput),
    ]) {
      expect(contextArguments.include).toEqual(historyArguments.include);
      expect(contextArguments.omit).toEqual(historyArguments.omit);
      expect(contextArguments).not.toHaveProperty("skip");
    }
  });
});
