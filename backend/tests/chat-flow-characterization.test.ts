import type { NextFunction, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    $transaction: vi.fn(),
    chat: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    chatMembers: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: { findMany: vi.fn() },
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

vi.mock("../src/utils/socket.util.js", () => ({
  emitEvent: vi.fn(),
  emitEventToRoom: vi.fn(),
}));

vi.mock("../src/utils/upload-lifecycle.util.js", () => ({
  cleanupTemporaryFiles: vi.fn(async () => undefined),
}));

import {
  addMemberToChat,
  createChat,
  removeMemberFromChat,
  updateChat,
} from "../src/controllers/chat.controller.js";
import { Events } from "../src/enums/event/event.enum.js";
import type { AuthenticatedRequest } from "../src/interfaces/auth/auth.interface.js";
import { prisma } from "../src/lib/prisma.lib.js";
import { deleteFilesFromCloudinary, uploadFilesToCloudinary } from "../src/utils/auth.util.js";
import {
  disconnectMembersFromChatRoom,
  joinMembersInChatRoom,
} from "../src/utils/chat.util.js";
import { emitEvent, emitEventToRoom } from "../src/utils/socket.util.js";
import { cleanupTemporaryFiles } from "../src/utils/upload-lifecycle.util.js";

const CREATOR_ID = "creator-user";
const CHAT_ID = "chat-1";
const io = { marker: "socket-server" };

const authorizedChat = ({
  adminId = CREATOR_ID,
  members = [CREATOR_ID, "member-1", "member-2", "member-3"],
}: {
  adminId?: string;
  members?: string[];
} = {}) => ({
  id: CHAT_ID,
  isGroupChat: true,
  adminId,
  avatarCloudinaryPublicId: "old-avatar",
  ChatMembers: members.map((userId) => ({ userId })),
});

const request = (overrides: Record<string, unknown> = {}) => ({
  user: { id: CREATOR_ID },
  params: { id: CHAT_ID },
  body: {},
  app: { get: vi.fn(() => io) },
  ...overrides,
} as unknown as AuthenticatedRequest);

const responseRecorder = () => {
  const status = vi.fn();
  const json = vi.fn();
  const send = vi.fn();
  const end = vi.fn();
  const response = { status, json, send, end } as unknown as Response;
  status.mockReturnValue(response);
  json.mockReturnValue(response);
  send.mockReturnValue(response);
  end.mockReturnValue(response);
  return { response, status, json, send, end };
};

const expectJsonResponse = (
  recorder: ReturnType<typeof responseRecorder>,
  statusCode: number,
  body: unknown,
) => {
  expect(recorder.status).toHaveBeenCalledWith(statusCode);
  expect(recorder.json).toHaveBeenCalledWith(body);
  expect(recorder.send).not.toHaveBeenCalled();
  expect(recorder.end).not.toHaveBeenCalled();
};

const expectCalledBefore = (first: ReturnType<typeof vi.fn>, second: ReturnType<typeof vi.fn>) => {
  expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0]);
};

describe("chat flow characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(authorizedChat() as never);
  });

  it("creates a group chat transactionally, joins all members, emits NEW_CHAT, and returns the projected chat", async () => {
    const avatar = { path: "temporary-avatar" } as Express.Multer.File;
    const transactionChatCreate = vi.fn().mockResolvedValue({ id: CHAT_ID });
    const transactionMemberCreateMany = vi.fn().mockResolvedValue({ count: 3 });
    vi.mocked(prisma.$transaction).mockImplementation(async (operation: never) => (
      (operation as (client: unknown) => Promise<unknown>)({
        chat: { create: transactionChatCreate },
        chatMembers: { createMany: transactionMemberCreateMany },
      })
    ) as never);
    vi.mocked(uploadFilesToCloudinary).mockResolvedValue([{
      public_id: "new-avatar",
      secure_url: "https://media.example/group.png",
    }] as never);
    const populatedChat = {
      id: CHAT_ID,
      name: "Architecture",
      avatar: "https://media.example/group.png",
      ChatMembers: [],
      latestMessage: null,
      UnreadMessages: [],
    };
    vi.mocked(prisma.chat.findUnique).mockResolvedValue(populatedChat as never);
    const recorder = responseRecorder();

    await createChat(request({
      body: {
        isGroupChat: "true",
        members: ["member-1", "member-2"],
        name: "Architecture",
      },
      file: avatar,
    }), recorder.response, vi.fn() as NextFunction);

    expect(uploadFilesToCloudinary).toHaveBeenCalledWith({ files: [avatar] });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionChatCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        adminId: CREATOR_ID,
        isGroupChat: true,
        name: "Architecture",
      }),
    }));
    expect(transactionMemberCreateMany).toHaveBeenCalledWith({
      data: ["member-1", "member-2", CREATOR_ID].map((userId) => ({
        chatId: CHAT_ID,
        userId,
      })),
    });
    expect(prisma.chat.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: CHAT_ID },
      omit: { avatarCloudinaryPublicId: true },
    }));
    expect(joinMembersInChatRoom).toHaveBeenCalledWith({
      memberIds: ["member-1", "member-2", CREATOR_ID],
      roomToJoin: CHAT_ID,
      io,
    });
    expect(emitEventToRoom).toHaveBeenCalledWith({
      event: Events.NEW_CHAT,
      io,
      room: CHAT_ID,
      data: { ...populatedChat, typingUsers: [] },
    });
    expectCalledBefore(transactionMemberCreateMany, vi.mocked(joinMembersInChatRoom));
    expectCalledBefore(vi.mocked(joinMembersInChatRoom), vi.mocked(emitEventToRoom));
    expectJsonResponse(recorder, 201, { ...populatedChat, typingUsers: [] });
    expect(cleanupTemporaryFiles).toHaveBeenCalledWith([avatar]);
  });

  it("rejects isGroupChat=false without persistence or realtime work", async () => {
    const recorder = responseRecorder();
    const next = vi.fn();

    await createChat(request({
      body: { isGroupChat: "false", members: ["member-1"], name: "Ignored" },
    }), recorder.response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400,
      message: "Only group chats can be created through this endpoint",
    }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(uploadFilesToCloudinary).not.toHaveBeenCalled();
    expect(joinMembersInChatRoom).not.toHaveBeenCalled();
    expect(emitEventToRoom).not.toHaveBeenCalled();
    expect(recorder.status).not.toHaveBeenCalled();
    expect(recorder.json).not.toHaveBeenCalled();
    expect(recorder.send).not.toHaveBeenCalled();
    expect(recorder.end).not.toHaveBeenCalled();
    expect(cleanupTemporaryFiles).toHaveBeenCalledWith([]);
  });

  it("adds group members after admin authorization, joins their sockets, emits both events, and returns the event payload", async () => {
    vi.mocked(prisma.chatMembers.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { user: { id: CREATOR_ID } },
        { user: { id: "member-1" } },
      ] as never);
    vi.mocked(prisma.chatMembers.createMany).mockResolvedValue({ count: 1 });
    const newMember = {
      id: "member-2",
      username: "new-member",
      avatar: "avatar",
      isOnline: false,
      publicKey: null,
      lastSeen: null,
      verificationBadge: false,
    };
    vi.mocked(prisma.user.findMany).mockResolvedValue([newMember] as never);
    const updatedChat = { id: CHAT_ID, ChatMembers: [], latestMessage: null };
    vi.mocked(prisma.chat.findUnique).mockResolvedValue(updatedChat as never);
    const recorder = responseRecorder();

    await addMemberToChat(request({ body: { members: ["member-2"] } }), recorder.response, vi.fn() as NextFunction);

    expect(prisma.chatMembers.createMany).toHaveBeenCalledWith({
      data: [{ chatId: CHAT_ID, userId: "member-2" }],
    });
    expect(joinMembersInChatRoom).toHaveBeenCalledWith({
      io,
      roomToJoin: CHAT_ID,
      memberIds: ["member-2"],
    });
    expect(emitEvent).toHaveBeenNthCalledWith(1, {
      event: Events.NEW_CHAT,
      data: { ...updatedChat, typingUsers: [], UnreadMessages: [] },
      io,
      users: ["member-2"],
    });
    expect(emitEvent).toHaveBeenNthCalledWith(2, {
      data: { chatId: CHAT_ID, members: [newMember] },
      event: Events.NEW_MEMBER_ADDED,
      io,
      users: [CREATOR_ID, "member-1"],
    });
    expectCalledBefore(vi.mocked(prisma.chat.findFirst), vi.mocked(prisma.chatMembers.createMany));
    expectCalledBefore(vi.mocked(prisma.chatMembers.createMany), vi.mocked(joinMembersInChatRoom));
    expectCalledBefore(vi.mocked(joinMembersInChatRoom), vi.mocked(emitEvent));
    expectJsonResponse(recorder, 200, {
      chatId: CHAT_ID,
      members: [newMember],
    });
  });

  it("removes members, removes their sockets, emits removed and remaining-member events, and returns the event payload", async () => {
    vi.mocked(prisma.chatMembers.findMany).mockResolvedValue([
      { userId: CREATOR_ID },
      { userId: "member-1" },
      { userId: "member-2" },
      { userId: "member-3" },
    ] as never);
    vi.mocked(prisma.chatMembers.deleteMany).mockResolvedValue({ count: 1 });
    const recorder = responseRecorder();

    await removeMemberFromChat(request({ body: { members: ["member-3"] } }), recorder.response, vi.fn() as NextFunction);

    expect(prisma.chatMembers.deleteMany).toHaveBeenCalledWith({
      where: { chatId: CHAT_ID, userId: { in: ["member-3"] } },
    });
    expect(disconnectMembersFromChatRoom).toHaveBeenCalledWith({
      io,
      memberIds: ["member-3"],
      roomToLeave: CHAT_ID,
    });
    expect(emitEvent).toHaveBeenNthCalledWith(1, {
      io,
      event: Events.DELETE_CHAT,
      users: ["member-3"],
      data: { chatId: CHAT_ID },
    });
    expect(emitEvent).toHaveBeenNthCalledWith(2, {
      io,
      event: Events.MEMBER_REMOVED,
      data: { chatId: CHAT_ID, membersId: ["member-3"] },
      users: [CREATOR_ID, "member-1", "member-2"],
    });
    expectCalledBefore(vi.mocked(prisma.chatMembers.deleteMany), vi.mocked(disconnectMembersFromChatRoom));
    expectCalledBefore(vi.mocked(disconnectMembersFromChatRoom), vi.mocked(emitEvent));
    expectJsonResponse(recorder, 200, {
      chatId: CHAT_ID,
      membersId: ["member-3"],
    });
  });

  it("reassigns the administrator before deleting membership when the current admin leaves", async () => {
    vi.mocked(prisma.chatMembers.findMany).mockResolvedValue([
      { userId: CREATOR_ID },
      { userId: "member-1" },
      { userId: "member-2" },
      { userId: "member-3" },
    ] as never);
    vi.mocked(prisma.chat.update).mockResolvedValue({ id: CHAT_ID } as never);
    vi.mocked(prisma.chatMembers.deleteMany).mockResolvedValue({ count: 1 });

    await removeMemberFromChat(
      request({ body: { members: [CREATOR_ID] } }),
      responseRecorder().response,
      vi.fn() as NextFunction,
    );

    expect(prisma.chat.update).toHaveBeenCalledWith({
      where: { id: CHAT_ID },
      data: { adminId: "member-1" },
    });
    expectCalledBefore(vi.mocked(prisma.chat.update), vi.mocked(prisma.chatMembers.deleteMany));
  });

  it("rejects removal when the chat currently has exactly three members", async () => {
    vi.mocked(prisma.chatMembers.findMany).mockResolvedValue([
      { userId: CREATOR_ID },
      { userId: "member-1" },
      { userId: "member-2" },
    ] as never);
    const next = vi.fn();

    await removeMemberFromChat(
      request({ body: { members: ["member-2"] } }),
      responseRecorder().response,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400,
      message: "Minimum 3 members are required in a group chat",
    }));
    expect(prisma.chatMembers.deleteMany).not.toHaveBeenCalled();
    expect(disconnectMembersFromChatRoom).not.toHaveBeenCalled();
  });

  it("updates group metadata after admin authorization, emits GROUP_CHAT_UPDATE, and returns the projected chat", async () => {
    const updatedChat = {
      id: CHAT_ID,
      name: "Renamed group",
      avatar: "existing-avatar",
    };
    vi.mocked(prisma.chat.update).mockResolvedValue(updatedChat as never);
    const recorder = responseRecorder();

    await updateChat(
      request({ body: { name: "Renamed group" } }),
      recorder.response,
      vi.fn() as NextFunction,
    );

    expect(prisma.chat.update).toHaveBeenCalledWith({
      where: { id: CHAT_ID },
      data: { name: "Renamed group" },
      select: { name: true, avatar: true, id: true },
    });
    expect(emitEventToRoom).toHaveBeenCalledWith({
      io,
      event: Events.GROUP_CHAT_UPDATE,
      room: CHAT_ID,
      data: {
        chatId: CHAT_ID,
        chatAvatar: "existing-avatar",
        chatName: "Renamed group",
      },
    });
    expect(deleteFilesFromCloudinary).not.toHaveBeenCalled();
    expectCalledBefore(vi.mocked(prisma.chat.findFirst), vi.mocked(prisma.chat.update));
    expectCalledBefore(vi.mocked(prisma.chat.update), vi.mocked(emitEventToRoom));
    expectJsonResponse(recorder, 200, updatedChat);
  });
});
