import type { NextFunction, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn() },
    friendRequest: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    friends: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    chat: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("../src/middlewares/rate-limit.middleware.js", () => ({
  BACKEND_RATE_LIMITS: {
    friendCreateCooldown: { namespace: "friend-create-cooldown", limit: 1, windowMs: 1 },
    friendCreateWindow: { namespace: "friend-create-window", limit: 10, windowMs: 1 },
    friendHandle: { namespace: "friend-handle", limit: 10, windowMs: 1 },
  },
  enforcePairRateLimit: vi.fn(() => true),
}));

vi.mock("../src/utils/chat.util.js", () => ({
  joinMembersInChatRoom: vi.fn(),
}));

vi.mock("../src/utils/generic.js", () => ({
  sendPushNotification: vi.fn(),
}));

vi.mock("../src/utils/socket.util.js", () => ({
  emitEvent: vi.fn(),
  emitEventToRoom: vi.fn(),
}));

import {
  createRequest,
  handleRequest,
} from "../src/controllers/request.controller.js";
import { Events } from "../src/enums/event/event.enum.js";
import type { AuthenticatedRequest } from "../src/interfaces/auth/auth.interface.js";
import { prisma } from "../src/lib/prisma.lib.js";
import {
  enforcePairRateLimit,
} from "../src/middlewares/rate-limit.middleware.js";
import { joinMembersInChatRoom } from "../src/utils/chat.util.js";
import { sendPushNotification } from "../src/utils/generic.js";
import { emitEvent, emitEventToRoom } from "../src/utils/socket.util.js";

const ACTOR_ID = "actor-user";
const OTHER_USER_ID = "other-user";
const REQUEST_ID = "request-1";
const CHAT_ID = "chat-1";
const io = { marker: "socket-server" };

const request = (overrides: Record<string, unknown> = {}) => ({
  user: { id: ACTOR_ID, username: "actor" },
  params: { id: REQUEST_ID },
  body: {},
  app: { get: vi.fn(() => io) },
  ...overrides,
} as unknown as AuthenticatedRequest);

const responseRecorder = () => {
  const status = vi.fn();
  const json = vi.fn();
  const response = { status, json } as unknown as Response;
  status.mockReturnValue(response);
  json.mockReturnValue(response);
  return { response, status, json };
};

const expectError = (next: ReturnType<typeof vi.fn>, statusCode: number, message: string) => {
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode, message }));
};

const expectCalledBefore = (first: ReturnType<typeof vi.fn>, second: ReturnType<typeof vi.fn>) => {
  expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0]);
};

const receiver = ({
  notificationsEnabled = true,
  fcmToken = "receiver-fcm-token",
}: {
  notificationsEnabled?: boolean;
  fcmToken?: string | null;
} = {}) => ({
  id: OTHER_USER_ID,
  notificationsEnabled,
  fcmToken,
});

describe("friend-request creation characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(enforcePairRateLimit).mockReturnValue(true);
  });

  it("looks up the receiver and then rejects a request to the authenticated user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: ACTOR_ID } as never);
    const next = vi.fn();

    await createRequest(
      request({ body: { receiver: ACTOR_ID } }),
      responseRecorder().response,
      next as NextFunction,
    );

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: ACTOR_ID } });
    expectError(next, 400, "You cannot send a request to yourself");
    expect(enforcePairRateLimit).not.toHaveBeenCalled();
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
  });

  it("rejects an existing outgoing pending request before reverse-request and friendship checks", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(receiver() as never);
    vi.mocked(prisma.friendRequest.findFirst).mockResolvedValueOnce({ id: "existing" } as never);
    const next = vi.fn();

    await createRequest(
      request({ body: { receiver: OTHER_USER_ID } }),
      responseRecorder().response,
      next as NextFunction,
    );

    expectError(next, 400, "Request is already sent, please wait for them to either accept or reject it");
    expect(prisma.friendRequest.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.friends.findFirst).not.toHaveBeenCalled();
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
  });

  it("rejects a reverse pending request before checking existing friendship", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(receiver() as never);
    vi.mocked(prisma.friendRequest.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "reverse-request" } as never);
    const next = vi.fn();

    await createRequest(
      request({ body: { receiver: OTHER_USER_ID } }),
      responseRecorder().response,
      next as NextFunction,
    );

    expectError(next, 400, "They have already sent you a friend request");
    expect(prisma.friendRequest.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.friends.findFirst).not.toHaveBeenCalled();
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
  });

  it("rejects users who are already friends after both pending-request checks", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(receiver() as never);
    vi.mocked(prisma.friendRequest.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.friends.findFirst).mockResolvedValue({ id: "friendship" } as never);
    const next = vi.fn();

    await createRequest(
      request({ body: { receiver: OTHER_USER_ID } }),
      responseRecorder().response,
      next as NextFunction,
    );

    expectError(next, 400, "You are already friends");
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
  });

  it("persists a request before notifying and emitting NEW_FRIEND_REQUEST", async () => {
    const otherUser = receiver();
    const createdRequest = {
      id: REQUEST_ID,
      sender: { id: ACTOR_ID, username: "actor" },
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(otherUser as never);
    vi.mocked(prisma.friendRequest.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.friends.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.friendRequest.create).mockResolvedValue(createdRequest as never);
    const recorder = responseRecorder();

    await createRequest(
      request({ body: { receiver: OTHER_USER_ID } }),
      recorder.response,
      vi.fn() as NextFunction,
    );

    expect(enforcePairRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: ACTOR_ID,
      otherUserId: OTHER_USER_ID,
    }));
    expect(sendPushNotification).toHaveBeenCalledWith({
      fcmToken: "receiver-fcm-token",
      body: expect.stringContaining("actor sent you a friend request"),
    });
    expect(emitEvent).toHaveBeenCalledWith({
      io,
      event: Events.NEW_FRIEND_REQUEST,
      data: createdRequest,
      users: [OTHER_USER_ID],
    });
    expectCalledBefore(vi.mocked(prisma.friendRequest.create), vi.mocked(sendPushNotification));
    expectCalledBefore(vi.mocked(sendPushNotification), vi.mocked(emitEvent));
    expect(recorder.status).toHaveBeenCalledWith(201);
    expect(recorder.json).toHaveBeenCalledWith({});
  });
});

describe("friend-request handling characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(enforcePairRateLimit).mockReturnValue(true);
  });

  it("accepts with separate non-transactional writes and preserves current side-effect order", async () => {
    const pendingRequest = {
      id: REQUEST_ID,
      senderId: OTHER_USER_ID,
      receiverId: ACTOR_ID,
    };
    const newChat = {
      id: CHAT_ID,
      ChatMembers: [],
      UnreadMessages: [],
      latestMessage: null,
    };
    vi.mocked(prisma.friendRequest.findFirst).mockResolvedValue(pendingRequest as never);
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.chat.create).mockResolvedValue(newChat as never);
    vi.mocked(prisma.friends.create).mockResolvedValue({
      user1: {
        id: OTHER_USER_ID,
        notificationsEnabled: true,
        fcmToken: "sender-fcm-token",
      },
      user2: { id: ACTOR_ID, notificationsEnabled: false, fcmToken: null },
    } as never);
    vi.mocked(prisma.friendRequest.delete).mockResolvedValue(pendingRequest as never);
    const recorder = responseRecorder();

    await handleRequest(
      request({ body: { action: "accept" } }),
      recorder.response,
      vi.fn() as NextFunction,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.chat.create).toHaveBeenCalledTimes(1);
    expect(prisma.friends.create).toHaveBeenCalledTimes(1);
    expect(sendPushNotification).toHaveBeenCalledWith({
      fcmToken: "sender-fcm-token",
      body: expect.stringContaining("actor has accepted your friend request"),
    });
    expect(joinMembersInChatRoom).toHaveBeenCalledWith({
      io,
      memberIds: [OTHER_USER_ID, ACTOR_ID],
      roomToJoin: CHAT_ID,
    });
    expect(prisma.friendRequest.delete).toHaveBeenCalledWith({ where: { id: REQUEST_ID } });
    expect(emitEventToRoom).toHaveBeenCalledWith({
      data: { ...newChat, typingUsers: [] },
      event: Events.NEW_CHAT,
      io,
      room: CHAT_ID,
    });
    expectCalledBefore(vi.mocked(prisma.chat.create), vi.mocked(prisma.friends.create));
    expectCalledBefore(vi.mocked(prisma.friends.create), vi.mocked(sendPushNotification));
    expectCalledBefore(vi.mocked(sendPushNotification), vi.mocked(joinMembersInChatRoom));
    expectCalledBefore(vi.mocked(joinMembersInChatRoom), vi.mocked(prisma.friendRequest.delete));
    expectCalledBefore(vi.mocked(prisma.friendRequest.delete), vi.mocked(emitEventToRoom));
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith({ id: REQUEST_ID });
  });

  it("conceals a request from anyone other than its receiver", async () => {
    vi.mocked(prisma.friendRequest.findFirst).mockResolvedValue({
      id: REQUEST_ID,
      senderId: OTHER_USER_ID,
      receiverId: "different-receiver",
    } as never);
    const next = vi.fn();

    await handleRequest(
      request({ body: { action: "accept" } }),
      responseRecorder().response,
      next as NextFunction,
    );

    expectError(next, 404, "Request not found");
    expect(enforcePairRateLimit).not.toHaveBeenCalled();
    expect(prisma.chat.create).not.toHaveBeenCalled();
    expect(prisma.friendRequest.delete).not.toHaveBeenCalled();
  });

  it("rejects by deleting the request, optionally notifying its sender, and emitting no chat event", async () => {
    const pendingRequest = {
      id: REQUEST_ID,
      senderId: OTHER_USER_ID,
      receiverId: ACTOR_ID,
    };
    vi.mocked(prisma.friendRequest.findFirst).mockResolvedValue(pendingRequest as never);
    vi.mocked(prisma.friendRequest.delete).mockResolvedValue({
      ...pendingRequest,
      sender: { notificationsEnabled: true, fcmToken: "sender-fcm-token" },
    } as never);
    const recorder = responseRecorder();

    await handleRequest(
      request({ body: { action: "reject" } }),
      recorder.response,
      vi.fn() as NextFunction,
    );

    expect(prisma.friendRequest.delete).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: REQUEST_ID },
    }));
    expect(sendPushNotification).toHaveBeenCalledWith({
      fcmToken: "sender-fcm-token",
      body: expect.stringContaining("actor has rejected your friend request"),
    });
    expect(joinMembersInChatRoom).not.toHaveBeenCalled();
    expect(emitEventToRoom).not.toHaveBeenCalled();
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith({ id: REQUEST_ID });
  });
});
