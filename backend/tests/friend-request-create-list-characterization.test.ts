import type { NextFunction, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    friendRequest: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    friends: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("../src/middlewares/rate-limit.middleware.js", () => ({
  BACKEND_RATE_LIMITS: {
    friendCreateCooldown: {
      namespace: "friend-create-cooldown",
      limit: 1,
      windowMs: 30_000,
    },
    friendCreateWindow: {
      namespace: "friend-create-window",
      limit: 10,
      windowMs: 60 * 60 * 1_000,
    },
  },
  enforcePairRateLimit: vi.fn(() => true),
}));

vi.mock("../src/modules/notifications/push-notification.service.js", () => ({
  sendPushNotification: vi.fn(),
}));

vi.mock("../src/utils/socket.util.js", () => ({
  emitEvent: vi.fn(),
  emitEventToRoom: vi.fn(),
}));

vi.mock("../src/utils/chat.util.js", () => ({
  joinMembersInChatRoom: vi.fn(),
}));

import {
  createRequest,
  getUserRequests,
} from "../src/controllers/request.controller.js";
import { Events } from "../src/enums/event/event.enum.js";
import type { AuthenticatedRequest } from "../src/interfaces/auth/auth.interface.js";
import { prisma } from "../src/lib/prisma.lib.js";
import {
  BACKEND_RATE_LIMITS,
  enforcePairRateLimit,
} from "../src/middlewares/rate-limit.middleware.js";
import { sendPushNotification } from "../src/modules/notifications/push-notification.service.js";
import { emitEvent } from "../src/utils/socket.util.js";

const ACTOR_ID = "actor-user";
const ACTOR_USERNAME = "actor";
const RECEIVER_ID = "receiver-user";
const REQUEST_ID = "request-1";
const io = { marker: "socket-server" };

const request = ({
  body = {},
  appGet = vi.fn(() => io),
}: {
  body?: Record<string, unknown>;
  appGet?: ReturnType<typeof vi.fn>;
} = {}) => ({
  user: {
    id: ACTOR_ID,
    username: ACTOR_USERNAME,
  },
  params: {},
  body,
  app: {
    get: appGet,
  },
} as unknown as AuthenticatedRequest);

const responseRecorder = () => {
  const status = vi.fn();
  const json = vi.fn();
  const response = { status, json } as unknown as Response;
  status.mockReturnValue(response);
  json.mockReturnValue(response);
  return { response, status, json };
};

const expectError = (
  next: ReturnType<typeof vi.fn>,
  statusCode: number,
  message: string,
) => {
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode, message }));
};

const expectCalledBefore = (
  first: ReturnType<typeof vi.fn>,
  second: ReturnType<typeof vi.fn>,
) => {
  expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0]);
};

const receiver = ({
  notificationsEnabled = true,
  fcmToken = "receiver-fcm-token",
}: {
  notificationsEnabled?: boolean;
  fcmToken?: string | null;
} = {}) => ({
  id: RECEIVER_ID,
  notificationsEnabled,
  fcmToken,
});

const createdRequest = {
  id: REQUEST_ID,
  status: "pending",
  createdAt: new Date("2026-08-27T10:00:00.000Z"),
  sender: {
    id: ACTOR_ID,
    username: ACTOR_USERNAME,
    avatar: "actor-avatar",
    isOnline: true,
    publicKey: "actor-public-key",
    lastSeen: new Date("2026-08-27T09:00:00.000Z"),
    verificationBadge: true,
  },
};

const senderProjection = {
  id: true,
  username: true,
  avatar: true,
  isOnline: true,
  publicKey: true,
  lastSeen: true,
  verificationBadge: true,
};

const createPersistenceShape = {
  data: {
    senderId: ACTOR_ID,
    receiverId: RECEIVER_ID,
  },
  include: {
    sender: {
      select: senderProjection,
    },
  },
  omit: {
    receiverId: true,
    updatedAt: true,
    senderId: true,
  },
};

const prepareSuccessfulCreate = ({
  recipient = receiver(),
  persistedRequest = createdRequest,
}: {
  recipient?: ReturnType<typeof receiver>;
  persistedRequest?: typeof createdRequest;
} = {}) => {
  vi.mocked(prisma.user.findUnique).mockResolvedValue(recipient as never);
  vi.mocked(prisma.friendRequest.findFirst)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null);
  vi.mocked(prisma.friends.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.friendRequest.create).mockResolvedValue(persistedRequest as never);
};

describe("friend-request list pre-extraction characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(enforcePairRateLimit).mockReturnValue(true);
  });

  it("uses the authenticated receiver filter and exact safe sender projection, then returns the unchanged array", async () => {
    const friendRequests = [{
      id: REQUEST_ID,
      senderId: "sender-user",
      status: "pending",
      createdAt: new Date("2026-08-27T08:00:00.000Z"),
      sender: {
        id: "sender-user",
        username: "sender",
        avatar: "sender-avatar",
        isOnline: false,
        publicKey: "sender-public-key",
        lastSeen: null,
        verificationBadge: false,
      },
    }];
    vi.mocked(prisma.friendRequest.findMany).mockResolvedValue(friendRequests as never);
    const recorder = responseRecorder();
    const next = vi.fn();

    await getUserRequests(request(), recorder.response, next as NextFunction);

    expect(prisma.friendRequest.findMany).toHaveBeenCalledWith({
      where: {
        receiverId: ACTOR_ID,
      },
      include: {
        sender: {
          select: senderProjection,
        },
      },
      omit: {
        receiverId: true,
        updatedAt: true,
      },
    });
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith(friendRequests);
    expect(recorder.json.mock.calls[0]?.[0]).toBe(friendRequests);
    expect(next).not.toHaveBeenCalled();
  });

  it("forwards a repository rejection without starting a response", async () => {
    const repositoryError = new Error("friend-request list failed");
    vi.mocked(prisma.friendRequest.findMany).mockRejectedValue(repositoryError);
    const recorder = responseRecorder();
    const next = vi.fn();

    await getUserRequests(request(), recorder.response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(repositoryError);
    expect(recorder.status).not.toHaveBeenCalled();
    expect(recorder.json).not.toHaveBeenCalled();
  });
});

describe("friend-request create pre-extraction characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(enforcePairRateLimit).mockReturnValue(true);
  });

  it("returns the exact concealed receiver error before rate limiting or later work", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const recorder = responseRecorder();
    const next = vi.fn();

    await createRequest(
      request({ body: { receiver: RECEIVER_ID } }),
      recorder.response,
      next as NextFunction,
    );

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: RECEIVER_ID } });
    expectError(next, 404, "Receiver not found");
    expect(enforcePairRateLimit).not.toHaveBeenCalled();
    expect(prisma.friendRequest.findFirst).not.toHaveBeenCalled();
    expect(prisma.friends.findFirst).not.toHaveBeenCalled();
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
    expect(recorder.status).not.toHaveBeenCalled();
    expect(recorder.json).not.toHaveBeenCalled();
  });

  it("enforces the exact pair policies after receiver lookup and before all duplicate and persistence work", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(receiver() as never);
    vi.mocked(enforcePairRateLimit).mockReturnValue(false);
    const appGet = vi.fn(() => io);
    const recorder = responseRecorder();
    const next = vi.fn();

    await createRequest(
      request({ body: { receiver: RECEIVER_ID }, appGet }),
      recorder.response,
      next as NextFunction,
    );

    expect(enforcePairRateLimit).toHaveBeenCalledWith({
      response: recorder.response,
      next,
      actorUserId: ACTOR_ID,
      otherUserId: RECEIVER_ID,
      policy: BACKEND_RATE_LIMITS.friendCreateCooldown,
      secondPolicy: BACKEND_RATE_LIMITS.friendCreateWindow,
    });
    expectCalledBefore(
      vi.mocked(prisma.user.findUnique),
      vi.mocked(enforcePairRateLimit),
    );
    expect(prisma.friendRequest.findFirst).not.toHaveBeenCalled();
    expect(prisma.friends.findFirst).not.toHaveBeenCalled();
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(appGet).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
    expect(recorder.status).not.toHaveBeenCalled();
    expect(recorder.json).not.toHaveBeenCalled();
  });

  it("uses the exact outgoing-request query and public duplicate message", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(receiver() as never);
    vi.mocked(prisma.friendRequest.findFirst).mockResolvedValueOnce({ id: "outgoing" } as never);
    const next = vi.fn();

    await createRequest(
      request({ body: { receiver: RECEIVER_ID } }),
      responseRecorder().response,
      next as NextFunction,
    );

    expect(prisma.friendRequest.findFirst).toHaveBeenCalledWith({
      where: {
        AND: [
          { receiverId: RECEIVER_ID },
          { senderId: ACTOR_ID },
        ],
      },
    });
    expectError(
      next,
      400,
      "Request is already sent, please wait for them to either accept or reject it",
    );
    expect(prisma.friendRequest.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.friends.findFirst).not.toHaveBeenCalled();
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
  });

  it("uses the exact reverse-request query and public reverse message", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(receiver() as never);
    vi.mocked(prisma.friendRequest.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "reverse" } as never);
    const next = vi.fn();

    await createRequest(
      request({ body: { receiver: RECEIVER_ID } }),
      responseRecorder().response,
      next as NextFunction,
    );

    expect(prisma.friendRequest.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        AND: [
          { receiverId: RECEIVER_ID },
          { senderId: ACTOR_ID },
        ],
      },
    });
    expect(prisma.friendRequest.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        AND: [
          { senderId: RECEIVER_ID },
          { receiverId: ACTOR_ID },
        ],
      },
    });
    expectError(next, 400, "They have already sent you a friend request");
    expect(prisma.friends.findFirst).not.toHaveBeenCalled();
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
  });

  it("uses the exact bidirectional friendship query and public friendship message", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(receiver() as never);
    vi.mocked(prisma.friendRequest.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.friends.findFirst).mockResolvedValue({ id: "friendship" } as never);
    const next = vi.fn();

    await createRequest(
      request({ body: { receiver: RECEIVER_ID } }),
      responseRecorder().response,
      next as NextFunction,
    );

    expect(prisma.friends.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { user1Id: ACTOR_ID, user2Id: RECEIVER_ID },
          { user1Id: RECEIVER_ID, user2Id: ACTOR_ID },
        ],
      },
    });
    expectError(next, 400, "You are already friends");
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
  });

  it("persists with the trusted actor and exact projection before exact push, realtime, and 201 response", async () => {
    prepareSuccessfulCreate();
    const appGet = vi.fn(() => io);
    const recorder = responseRecorder();
    const next = vi.fn();

    await createRequest(
      request({
        body: {
          receiver: RECEIVER_ID,
          senderId: "spoofed-body-sender",
        },
        appGet,
      }),
      recorder.response,
      next as NextFunction,
    );

    expect(prisma.friendRequest.create).toHaveBeenCalledWith(createPersistenceShape);
    expect(sendPushNotification).toHaveBeenCalledWith({
      recipientToken: "receiver-fcm-token",
      body: `${ACTOR_USERNAME} sent you a friend request 😃`,
    });
    expect(appGet).toHaveBeenCalledWith("io");
    expect(emitEvent).toHaveBeenCalledWith({
      io,
      event: Events.NEW_FRIEND_REQUEST,
      data: createdRequest,
      users: [RECEIVER_ID],
    });
    expectCalledBefore(vi.mocked(prisma.friendRequest.create), vi.mocked(sendPushNotification));
    expectCalledBefore(vi.mocked(sendPushNotification), appGet);
    expectCalledBefore(appGet, vi.mocked(emitEvent));
    expectCalledBefore(vi.mocked(emitEvent), recorder.status);
    expectCalledBefore(recorder.status, recorder.json);
    expect(recorder.status).toHaveBeenCalledWith(201);
    expect(recorder.json).toHaveBeenCalledWith({});
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ["notifications disabled", receiver({ notificationsEnabled: false })],
    ["missing FCM token", receiver({ fcmToken: null })],
  ])("still persists, emits, and responds when %s", async (_label, recipient) => {
    prepareSuccessfulCreate({ recipient });
    const recorder = responseRecorder();

    await createRequest(
      request({ body: { receiver: RECEIVER_ID } }),
      recorder.response,
      vi.fn() as NextFunction,
    );

    expect(prisma.friendRequest.create).toHaveBeenCalledWith(createPersistenceShape);
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledWith({
      io,
      event: Events.NEW_FRIEND_REQUEST,
      data: createdRequest,
      users: [RECEIVER_ID],
    });
    expect(recorder.status).toHaveBeenCalledWith(201);
    expect(recorder.json).toHaveBeenCalledWith({});
  });

  it("cuts off push, Socket access, realtime, and the response when persistence rejects", async () => {
    const persistenceError = new Error("friend-request create failed");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(receiver() as never);
    vi.mocked(prisma.friendRequest.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.friends.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.friendRequest.create).mockRejectedValue(persistenceError);
    const appGet = vi.fn(() => io);
    const recorder = responseRecorder();
    const next = vi.fn();

    await createRequest(
      request({ body: { receiver: RECEIVER_ID }, appGet }),
      recorder.response,
      next as NextFunction,
    );

    expect(prisma.friendRequest.create).toHaveBeenCalledWith(createPersistenceShape);
    expect(next).toHaveBeenCalledWith(persistenceError);
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(appGet).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
    expect(recorder.status).not.toHaveBeenCalled();
    expect(recorder.json).not.toHaveBeenCalled();
  });
});
