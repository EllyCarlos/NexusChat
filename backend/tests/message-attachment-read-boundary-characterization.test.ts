import { readFileSync } from "node:fs";
import type { NextFunction, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    chat: { findFirst: vi.fn() },
    message: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    attachment: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("../src/utils/auth.util.js", () => ({
  deleteFilesFromCloudinary: vi.fn(),
  uploadFilesToCloudinary: vi.fn(),
}));

vi.mock("../src/utils/socket.util.js", () => ({
  emitEventToRoom: vi.fn(),
}));

vi.mock("../src/utils/upload-lifecycle.util.js", () => ({
  cleanupTemporaryFiles: vi.fn(async () => undefined),
}));

import { fetchAttachments } from "../src/controllers/attachment.controller.js";
import { getMessages } from "../src/controllers/message.controller.js";
import type { AuthenticatedRequest } from "../src/interfaces/auth/auth.interface.js";
import { prisma } from "../src/lib/prisma.lib.js";

const ACTOR_ID = "actor-user";
const CHAT_ID = "chat-1";

const memberChat = {
  id: CHAT_ID,
  isGroupChat: false,
  adminId: null,
  avatarCloudinaryPublicId: null,
  ChatMembers: [{ userId: ACTOR_ID }],
};

const request = (query: Record<string, unknown> = {}) => ({
  user: { id: ACTOR_ID },
  params: { id: CHAT_ID },
  query,
} as unknown as AuthenticatedRequest);

const responseRecorder = () => {
  const status = vi.fn();
  const json = vi.fn();
  const response = { status, json } as unknown as Response;
  status.mockReturnValue(response);
  json.mockReturnValue(response);
  return { response, status, json };
};

const expectCalledBefore = (
  first: { mock: { invocationCallOrder: number[] } },
  second: { mock: { invocationCallOrder: number[] } },
) => {
  expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0]);
};

const expectedMessageFindManyArguments = {
  where: {
    chatId: CHAT_ID,
  },
  include: {
    sender: {
      select: {
        id: true,
        username: true,
        avatar: true,
      },
    },
    attachments: {
      select: {
        secureUrl: true,
      },
    },
    poll: {
      omit: {
        id: true,
      },
      include: {
        votes: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatar: true,
              },
            },
          },
          omit: {
            id: true,
            pollId: true,
            userId: true,
          },
        },
      },
    },
    reactions: {
      select: {
        user: {
          select: {
            id: true,
            username: true,
            avatar: true,
          },
        },
        reaction: true,
      },
    },
    replyToMessage: {
      select: {
        sender: {
          select: {
            id: true,
            username: true,
            avatar: true,
          },
        },
        id: true,
        textMessageContent: true,
        isPollMessage: true,
        url: true,
        audioUrl: true,
        attachments: {
          select: {
            secureUrl: true,
          },
        },
      },
    },
  },
  omit: {
    senderId: true,
    pollId: true,
  },
  orderBy: {
    createdAt: "desc",
  },
  skip: 0,
  take: 20,
};

describe("message read boundary characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(memberChat as never);
    vi.mocked(prisma.message.findMany).mockResolvedValue([]);
    vi.mocked(prisma.message.count).mockResolvedValue(0);
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([]);
    vi.mocked(prisma.attachment.count).mockResolvedValue(0);
  });

  it("freezes the complete message page/count shapes and sequential reversed response", async () => {
    const newerMessage = { id: "message-2", textMessageContent: "newer" };
    const olderMessage = { id: "message-1", textMessageContent: "older" };
    const repositoryMessages = [newerMessage, olderMessage];
    vi.mocked(prisma.message.findMany).mockResolvedValue(repositoryMessages as never);
    vi.mocked(prisma.message.count).mockResolvedValue(21);
    const recorder = responseRecorder();

    await getMessages(request(), recorder.response, vi.fn() as NextFunction);

    expect(prisma.message.findMany).toHaveBeenCalledWith(expectedMessageFindManyArguments);
    expect(prisma.message.count).toHaveBeenCalledWith({ where: { chatId: CHAT_ID } });
    expect(repositoryMessages).toEqual([olderMessage, newerMessage]);
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith({
      messages: [olderMessage, newerMessage],
      totalPages: 2,
    });
    expectCalledBefore(vi.mocked(prisma.message.findMany), vi.mocked(prisma.message.count));
    expectCalledBefore(vi.mocked(prisma.message.count), recorder.status);
    expectCalledBefore(recorder.status, recorder.json);
  });

  it("stops before count, reversal, and response when message page lookup fails", async () => {
    const failure = new Error("message page failed");
    vi.mocked(prisma.message.findMany).mockRejectedValue(failure);
    const next = vi.fn();
    const recorder = responseRecorder();

    await getMessages(request(), recorder.response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(failure);
    expect(prisma.message.count).not.toHaveBeenCalled();
    expect(recorder.status).not.toHaveBeenCalled();
    expect(recorder.json).not.toHaveBeenCalled();
  });

  it("does not reverse the fetched message array or respond when count fails", async () => {
    const newerMessage = { id: "message-2" };
    const olderMessage = { id: "message-1" };
    const repositoryMessages = [newerMessage, olderMessage];
    const failure = new Error("message count failed");
    vi.mocked(prisma.message.findMany).mockResolvedValue(repositoryMessages as never);
    vi.mocked(prisma.message.count).mockRejectedValue(failure);
    const next = vi.fn();
    const recorder = responseRecorder();

    await getMessages(request(), recorder.response, next as NextFunction);

    expect(prisma.message.count).toHaveBeenCalledWith({ where: { chatId: CHAT_ID } });
    expect(repositoryMessages).toEqual([newerMessage, olderMessage]);
    expect(next).toHaveBeenCalledWith(failure);
    expect(recorder.status).not.toHaveBeenCalled();
    expect(recorder.json).not.toHaveBeenCalled();
  });

  it("preserves fractional message pagination through Number coercion and ceil skip", async () => {
    await getMessages(
      request({ page: "1.2", limit: "6" }),
      responseRecorder().response,
      vi.fn() as NextFunction,
    );

    expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 2,
      take: 6,
    }));
  });
});

describe("attachment read boundary characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(memberChat as never);
    vi.mocked(prisma.message.findMany).mockResolvedValue([]);
    vi.mocked(prisma.message.count).mockResolvedValue(0);
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([]);
    vi.mocked(prisma.attachment.count).mockResolvedValue(0);
  });

  it("freezes default attachment page/count shapes and strict sequential response order", async () => {
    const attachments = [{ secureUrl: "https://media.example/attachment-1" }];
    vi.mocked(prisma.attachment.findMany).mockResolvedValue(attachments as never);
    vi.mocked(prisma.attachment.count).mockResolvedValue(7);
    const recorder = responseRecorder();

    await fetchAttachments(request(), recorder.response, vi.fn() as NextFunction);

    expect(prisma.attachment.findMany).toHaveBeenCalledWith({
      where: { message: { chatId: CHAT_ID } },
      omit: {
        id: true,
        cloudinaryPublicId: true,
        messageId: true,
      },
      orderBy: {
        message: { createdAt: "desc" },
      },
      skip: 0,
      take: 6,
    });
    expect(prisma.attachment.count).toHaveBeenCalledWith({
      where: { message: { chatId: CHAT_ID } },
    });
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith({
      attachments,
      totalAttachmentsCount: 7,
      totalPages: 2,
    });
    expectCalledBefore(vi.mocked(prisma.attachment.findMany), vi.mocked(prisma.attachment.count));
    expectCalledBefore(vi.mocked(prisma.attachment.count), recorder.status);
    expectCalledBefore(recorder.status, recorder.json);
  });

  it("stops before count and response when attachment page lookup fails", async () => {
    const failure = new Error("attachment page failed");
    vi.mocked(prisma.attachment.findMany).mockRejectedValue(failure);
    const next = vi.fn();
    const recorder = responseRecorder();

    await fetchAttachments(request(), recorder.response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(failure);
    expect(prisma.attachment.count).not.toHaveBeenCalled();
    expect(recorder.status).not.toHaveBeenCalled();
    expect(recorder.json).not.toHaveBeenCalled();
  });

  it("stops after a successful attachment page when count fails", async () => {
    const attachments = [{ secureUrl: "https://media.example/attachment-1" }];
    const failure = new Error("attachment count failed");
    vi.mocked(prisma.attachment.findMany).mockResolvedValue(attachments as never);
    vi.mocked(prisma.attachment.count).mockRejectedValue(failure);
    const next = vi.fn();
    const recorder = responseRecorder();

    await fetchAttachments(request(), recorder.response, next as NextFunction);

    expect(prisma.attachment.count).toHaveBeenCalledWith({
      where: { message: { chatId: CHAT_ID } },
    });
    expect(attachments).toEqual([{ secureUrl: "https://media.example/attachment-1" }]);
    expect(next).toHaveBeenCalledWith(failure);
    expect(recorder.status).not.toHaveBeenCalled();
    expect(recorder.json).not.toHaveBeenCalled();
  });

  it("preserves fractional attachment pagination through Number coercion and ceil skip", async () => {
    await fetchAttachments(
      request({ page: "1.2", limit: "6" }),
      responseRecorder().response,
      vi.fn() as NextFunction,
    );

    expect(prisma.attachment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 2,
      take: 6,
    }));
  });
});

describe("message and attachment read route contracts", () => {
  it.each([
    {
      file: "../src/routes/message.router.ts",
      route: ".get(\"/:id\",verifyToken,getMessages)",
    },
    {
      file: "../src/routes/attachment.router.ts",
      route: ".get(\"/:id\",verifyToken,fetchAttachments)",
    },
  ])("keeps $file as verifyToken then controller with no read validation middleware", ({ file, route }) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    const normalizedSource = source.replace(/\s/g, "");

    expect(normalizedSource).toContain(route);
  });
});
