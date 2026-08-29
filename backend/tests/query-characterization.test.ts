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

const expectNotFound = (next: ReturnType<typeof vi.fn>) => {
  expect(next).toHaveBeenCalledWith(expect.objectContaining({
    statusCode: 404,
    message: "Chat not found",
  }));
};

describe("message pagination characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(memberChat as never);
    vi.mocked(prisma.message.findMany).mockResolvedValue([]);
    vi.mocked(prisma.message.count).mockResolvedValue(0);
  });

  it("returns page one in chronological response order with the current Prisma projection", async () => {
    const newerMessage = { id: "message-2", textMessageContent: "newer" };
    const olderMessage = { id: "message-1", textMessageContent: "older" };
    vi.mocked(prisma.message.findMany).mockResolvedValue([newerMessage, olderMessage] as never);
    vi.mocked(prisma.message.count).mockResolvedValue(21);
    const recorder = responseRecorder();

    await getMessages(request(), recorder.response, vi.fn() as NextFunction);

    expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { chatId: CHAT_ID },
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 20,
      omit: { senderId: true, pollId: true },
      include: expect.objectContaining({
        sender: expect.any(Object),
        attachments: expect.any(Object),
        poll: expect.any(Object),
        reactions: expect.any(Object),
        replyToMessage: expect.any(Object),
      }),
    }));
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith({
      messages: [olderMessage, newerMessage],
      totalPages: 2,
    });
  });

  it("calculates skip and total pages for a later page", async () => {
    vi.mocked(prisma.message.findMany).mockResolvedValue([{ id: "message-3" }] as never);
    vi.mocked(prisma.message.count).mockResolvedValue(5);
    const recorder = responseRecorder();

    await getMessages(request({ page: "2", limit: "2" }), recorder.response, vi.fn() as NextFunction);

    expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 2, take: 2 }));
    expect(recorder.json).toHaveBeenCalledWith({
      messages: [{ id: "message-3" }],
      totalPages: 3,
    });
  });

  it("returns an empty page with zero total pages", async () => {
    const recorder = responseRecorder();

    await getMessages(request(), recorder.response, vi.fn() as NextFunction);

    expect(recorder.json).toHaveBeenCalledWith({ messages: [], totalPages: 0 });
  });

  it("rejects a non-member before message queries", async () => {
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(null);
    const next = vi.fn();

    await getMessages(request(), responseRecorder().response, next as NextFunction);

    expectNotFound(next);
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(prisma.message.count).not.toHaveBeenCalled();
  });

  it.each([
    { label: "non-numeric page", query: { page: "invalid", limit: "20" }, skip: Number.NaN, take: 20 },
    { label: "negative page", query: { page: "-1", limit: "20" }, skip: -40, take: 20 },
    { label: "zero page", query: { page: "0", limit: "20" }, skip: -20, take: 20 },
    { label: "excessive limit", query: { page: "1", limit: "1000000" }, skip: 0, take: 1_000_000 },
  ])("passes $label through to Prisma without validation", async ({ query, skip, take }) => {
    await getMessages(request(query), responseRecorder().response, vi.fn() as NextFunction);

    const findArguments = vi.mocked(prisma.message.findMany).mock.calls[0]?.[0];
    expect(findArguments?.skip).toEqual(skip);
    expect(findArguments?.take).toBe(take);
  });

  it("forwards a Prisma pagination rejection through the Express error boundary", async () => {
    const databaseError = new Error("invalid pagination at provider boundary");
    vi.mocked(prisma.message.findMany).mockRejectedValue(databaseError);
    const next = vi.fn();

    await getMessages(
      request({ page: "invalid" }),
      responseRecorder().response,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledWith(databaseError);
    expect(prisma.message.count).not.toHaveBeenCalled();
  });
});

describe("attachment pagination characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(memberChat as never);
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([]);
    vi.mocked(prisma.attachment.count).mockResolvedValue(0);
  });

  it("returns the current secure attachment projection and page totals", async () => {
    const attachments = [
      { secureUrl: "https://media.example/attachment-1" },
      { secureUrl: "https://media.example/attachment-2" },
    ];
    vi.mocked(prisma.attachment.findMany).mockResolvedValue(attachments as never);
    vi.mocked(prisma.attachment.count).mockResolvedValue(13);
    const recorder = responseRecorder();

    await fetchAttachments(
      request({ page: "2", limit: "6" }),
      recorder.response,
      vi.fn() as NextFunction,
    );

    expect(prisma.attachment.findMany).toHaveBeenCalledWith({
      where: { message: { chatId: CHAT_ID } },
      omit: { id: true, cloudinaryPublicId: true, messageId: true },
      orderBy: { message: { createdAt: "desc" } },
      skip: 6,
      take: 6,
    });
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith({
      attachments,
      totalAttachmentsCount: 13,
      totalPages: 3,
    });
  });

  it("returns an empty attachment page with zero totals", async () => {
    const recorder = responseRecorder();

    await fetchAttachments(request(), recorder.response, vi.fn() as NextFunction);

    expect(recorder.json).toHaveBeenCalledWith({
      attachments: [],
      totalAttachmentsCount: 0,
      totalPages: 0,
    });
  });

  it("rejects a non-member before attachment queries", async () => {
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(null);
    const next = vi.fn();

    await fetchAttachments(request(), responseRecorder().response, next as NextFunction);

    expectNotFound(next);
    expect(prisma.attachment.findMany).not.toHaveBeenCalled();
    expect(prisma.attachment.count).not.toHaveBeenCalled();
  });

  it.each([
    { label: "non-numeric page", query: { page: "invalid", limit: "6" }, skip: Number.NaN, take: 6 },
    { label: "negative page", query: { page: "-1", limit: "6" }, skip: -12, take: 6 },
    { label: "zero page", query: { page: "0", limit: "6" }, skip: -6, take: 6 },
    { label: "non-numeric limit", query: { page: "1", limit: "invalid" }, skip: Number.NaN, take: Number.NaN },
  ])("passes $label through to Prisma without validation", async ({ query, skip, take }) => {
    await fetchAttachments(request(query), responseRecorder().response, vi.fn() as NextFunction);

    const findArguments = vi.mocked(prisma.attachment.findMany).mock.calls[0]?.[0];
    expect(findArguments?.skip).toEqual(skip);
    expect(findArguments?.take).toEqual(take);
  });
});
