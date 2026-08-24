import type { NextFunction, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    chat: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    message: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    attachment: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    unreadMessages: {
      upsert: vi.fn(),
    },
    friendRequest: {
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("../src/utils/auth.util.js", () => ({
  deleteFilesFromCloudinary: vi.fn(),
  uploadFilesToCloudinary: vi.fn(),
}));

vi.mock("../src/utils/chat.util.js", () => ({
  disconnectMembersFromChatRoom: vi.fn(),
  joinMembersInChatRoom: vi.fn(),
}));

vi.mock("../src/utils/generic.js", () => ({
  calculateSkip: (page: number, limit: number) => (page - 1) * limit,
  sendPushNotification: vi.fn(),
}));

vi.mock("../src/utils/socket.util.js", () => ({
  emitEvent: vi.fn(),
  emitEventToRoom: vi.fn(),
}));

import { fetchAttachments, uploadAttachment } from "../src/controllers/attachment.controller.js";
import { updateChat } from "../src/controllers/chat.controller.js";
import { getMessages } from "../src/controllers/message.controller.js";
import { handleRequest } from "../src/controllers/request.controller.js";
import type { AuthenticatedRequest } from "../src/interfaces/auth/auth.interface.js";
import { prisma } from "../src/lib/prisma.lib.js";
import {
  authorizeAttachmentUpload,
  authorizeGroupChatUpload,
} from "../src/middlewares/upload-authorization.middleware.js";
import { assertChatAdmin, assertChatMember } from "../src/services/authorization.service.js";
import { deleteFilesFromCloudinary, uploadFilesToCloudinary } from "../src/utils/auth.util.js";

const ACTOR_ID = "actor-user";
const CHAT_ID = "chat-1";

const memberChat = ({
  adminId = "group-admin",
  isGroupChat = true,
  members = [ACTOR_ID],
}: {
  adminId?: string;
  isGroupChat?: boolean;
  members?: string[];
} = {}) => ({
  id: CHAT_ID,
  isGroupChat,
  adminId,
  avatarCloudinaryPublicId: "old-avatar",
  ChatMembers: members.map((userId) => ({ userId })),
});

const request = (overrides: Record<string, unknown> = {}) => ({
  user: { id: ACTOR_ID },
  params: { id: CHAT_ID, chatId: CHAT_ID },
  query: {},
  body: {},
  app: { get: vi.fn(() => ({})) },
  ...overrides,
} as unknown as AuthenticatedRequest);

const response = () => {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response;
};

const errorFrom = (next: ReturnType<typeof vi.fn>, statusCode: number) => {
  expect(next).toHaveBeenCalledTimes(1);
  const error = next.mock.calls[0]?.[0];
  expect(error).toMatchObject({ statusCode });
  return error;
};

const chatFindFirst = vi.mocked(prisma.chat.findFirst);
const messageFindMany = vi.mocked(prisma.message.findMany);
const messageCount = vi.mocked(prisma.message.count);
const messageCreate = vi.mocked(prisma.message.create);
const attachmentFindMany = vi.mocked(prisma.attachment.findMany);
const attachmentCount = vi.mocked(prisma.attachment.count);
const chatUpdate = vi.mocked(prisma.chat.update);
const chatFindUnique = vi.mocked(prisma.chat.findUnique);
const friendRequestFindFirst = vi.mocked(prisma.friendRequest.findFirst);
const friendRequestDelete = vi.mocked(prisma.friendRequest.delete);
const uploadToCloudinary = vi.mocked(uploadFilesToCloudinary);
const deleteFromCloudinary = vi.mocked(deleteFilesFromCloudinary);

describe("REST object authorization helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a valid chat member using an authoritative membership predicate", async () => {
    const chat = memberChat();
    chatFindFirst.mockResolvedValue(chat as never);

    await expect(assertChatMember(ACTOR_ID, CHAT_ID)).resolves.toEqual(chat);
    expect(chatFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: CHAT_ID,
        ChatMembers: { some: { userId: ACTOR_ID } },
      },
    }));
  });

  it("accepts a valid group administrator", async () => {
    const chat = memberChat({ adminId: ACTOR_ID });
    chatFindFirst.mockResolvedValue(chat as never);

    await expect(assertChatAdmin(ACTOR_ID, CHAT_ID)).resolves.toEqual(chat);
  });

  it.each(["non-member", "nonexistent chat"])("returns 404 for a %s without disclosing existence", async () => {
    chatFindFirst.mockResolvedValue(null);

    await expect(assertChatMember(ACTOR_ID, CHAT_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns 403 when a confirmed member is not the group administrator", async () => {
    chatFindFirst.mockResolvedValue(memberChat() as never);

    await expect(assertChatAdmin(ACTOR_ID, CHAT_ID)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("message and attachment reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a non-member message read before message queries", async () => {
    chatFindFirst.mockResolvedValue(null);
    const next = vi.fn();

    await getMessages(request({ body: { userId: "member-user" } }), response(), next as NextFunction);

    errorFrom(next, 404);
    expect(messageFindMany).not.toHaveBeenCalled();
    expect(messageCount).not.toHaveBeenCalled();
  });

  it("allows a member message read and ignores client-supplied actor identity", async () => {
    chatFindFirst.mockResolvedValue(memberChat() as never);
    messageFindMany.mockResolvedValue([]);
    messageCount.mockResolvedValue(0);
    const res = response();

    await getMessages(request({ body: { userId: "member-user" } }), res, vi.fn() as NextFunction);

    expect(chatFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ChatMembers: { some: { userId: ACTOR_ID } } }),
    }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ messages: [], totalPages: 0 });
  });

  it("rejects a non-member attachment read before attachment queries", async () => {
    chatFindFirst.mockResolvedValue(null);
    const next = vi.fn();

    await fetchAttachments(request(), response(), next as NextFunction);

    errorFrom(next, 404);
    expect(attachmentFindMany).not.toHaveBeenCalled();
    expect(attachmentCount).not.toHaveBeenCalled();
  });

  it("allows a member attachment read", async () => {
    chatFindFirst.mockResolvedValue(memberChat() as never);
    attachmentFindMany.mockResolvedValue([]);
    attachmentCount.mockResolvedValue(0);
    const res = response();

    await fetchAttachments(request(), res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      attachments: [],
      totalAttachmentsCount: 0,
      totalPages: 0,
    });
  });
});

describe("attachment upload authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a non-member before Multer disk storage is reached", async () => {
    chatFindFirst.mockResolvedValue(null);
    const next = vi.fn();
    const req = request();

    await authorizeAttachmentUpload(req, response(), next as NextFunction);

    errorFrom(next, 404);
  });

  it("rejects a non-member controller call before Cloudinary or database writes", async () => {
    chatFindFirst.mockResolvedValue(null);
    const next = vi.fn();

    await uploadAttachment(request({
      body: { chatId: CHAT_ID },
      files: [{ mimetype: "image/png", originalname: "image.png" }],
    }), response(), next as NextFunction);

    errorFrom(next, 404);
    expect(uploadToCloudinary).not.toHaveBeenCalled();
    expect(messageCreate).not.toHaveBeenCalled();
    expect(prisma.unreadMessages.upsert).not.toHaveBeenCalled();
  });

  it("allows a member upload, authorizes first, and uses only req.user as sender", async () => {
    chatFindFirst.mockResolvedValue(memberChat({ members: [ACTOR_ID] }) as never);
    uploadToCloudinary.mockResolvedValue([{
      secure_url: "https://example.test/file.png",
      public_id: "uploaded-file",
    }] as never);
    messageCreate.mockResolvedValue({
      id: "message-1",
      attachments: [{ secureUrl: "https://example.test/file.png" }],
      createdAt: new Date(),
      sender: { id: ACTOR_ID, username: "actor", avatar: "avatar" },
    } as never);
    const res = response();

    await uploadAttachment(request({
      body: { chatId: CHAT_ID, userId: "attacker-controlled" },
      files: [{ mimetype: "image/png", originalname: "image.png" }],
    }), res, vi.fn() as NextFunction);

    expect(chatFindFirst.mock.invocationCallOrder[0]).toBeLessThan(uploadToCloudinary.mock.invocationCallOrder[0]);
    expect(messageCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ chatId: CHAT_ID, senderId: ACTOR_ID }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe("group metadata authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a non-member before Cloudinary or chat updates", async () => {
    chatFindFirst.mockResolvedValue(null);
    const next = vi.fn();

    await updateChat(request({ body: { name: "Renamed" } }), response(), next as NextFunction);

    errorFrom(next, 404);
    expect(deleteFromCloudinary).not.toHaveBeenCalled();
    expect(uploadToCloudinary).not.toHaveBeenCalled();
    expect(chatUpdate).not.toHaveBeenCalled();
  });

  it("rejects a member who is not admin before Cloudinary or chat updates", async () => {
    chatFindFirst.mockResolvedValue(memberChat() as never);
    const next = vi.fn();

    await updateChat(request({ body: { name: "Renamed" } }), response(), next as NextFunction);

    errorFrom(next, 403);
    expect(deleteFromCloudinary).not.toHaveBeenCalled();
    expect(uploadToCloudinary).not.toHaveBeenCalled();
    expect(chatUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-admin group avatar before Multer disk storage is reached", async () => {
    chatFindFirst.mockResolvedValue(memberChat() as never);
    const next = vi.fn();

    await authorizeGroupChatUpload(request(), response(), next as NextFunction);

    errorFrom(next, 403);
  });

  it("allows an admin avatar update only after authorization", async () => {
    chatFindFirst.mockResolvedValue(memberChat({ adminId: ACTOR_ID }) as never);
    deleteFromCloudinary.mockResolvedValue(undefined);
    uploadToCloudinary.mockResolvedValue([{
      secure_url: "https://example.test/avatar.png",
      public_id: "new-avatar",
    }] as never);
    chatUpdate.mockResolvedValue({ id: CHAT_ID, name: "Group", avatar: "avatar" } as never);
    chatFindUnique.mockResolvedValue({ id: CHAT_ID, name: "Group", avatar: "avatar" } as never);
    const res = response();

    await updateChat(request({
      file: { mimetype: "image/png", originalname: "avatar.png" },
    }), res, vi.fn() as NextFunction);

    expect(chatFindFirst.mock.invocationCallOrder[0]).toBeLessThan(uploadToCloudinary.mock.invocationCallOrder[0]);
    expect(uploadToCloudinary.mock.invocationCallOrder[0]).toBeLessThan(chatUpdate.mock.invocationCallOrder[0]);
    expect(chatUpdate.mock.invocationCallOrder[0]).toBeLessThan(deleteFromCloudinary.mock.invocationCallOrder[0]);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns 400 for a malformed update without querying or mutating a chat", async () => {
    const next = vi.fn();

    await updateChat(request(), response(), next as NextFunction);

    errorFrom(next, 400);
    expect(chatFindFirst).not.toHaveBeenCalled();
    expect(chatUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent group target", async () => {
    chatFindFirst.mockResolvedValue(null);
    const next = vi.fn();

    await updateChat(request({ body: { name: "Renamed" } }), response(), next as NextFunction);

    errorFrom(next, 404);
    expect(chatUpdate).not.toHaveBeenCalled();
  });
});

describe("existing request authorization status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a generic 404 when the actor is not the request receiver", async () => {
    friendRequestFindFirst.mockResolvedValue({
      id: "request-1",
      receiverId: "another-user",
      senderId: "sender-user",
    } as never);
    const next = vi.fn();

    await handleRequest(request({
      params: { id: "request-1" },
      body: { action: "reject" },
    }), response(), next as NextFunction);

    errorFrom(next, 404);
    expect(friendRequestDelete).not.toHaveBeenCalled();
  });
});
