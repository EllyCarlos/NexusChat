import type { NextFunction, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    friendRequest: {
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    friends: {
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

vi.mock("../src/modules/notifications/push-notification.service.js", () => ({
  sendPushNotification: vi.fn(),
}));

vi.mock("../src/utils/socket.util.js", () => ({
  emitEvent: vi.fn(),
  emitEventToRoom: vi.fn(),
}));

import { handleRequest } from "../src/controllers/request.controller.js";
import { Events } from "../src/enums/event/event.enum.js";
import type { AuthenticatedRequest } from "../src/interfaces/auth/auth.interface.js";
import { prisma } from "../src/lib/prisma.lib.js";
import {
  BACKEND_RATE_LIMITS,
  enforcePairRateLimit,
} from "../src/middlewares/rate-limit.middleware.js";
import { joinMembersInChatRoom } from "../src/utils/chat.util.js";
import { sendPushNotification } from "../src/modules/notifications/push-notification.service.js";
import { emitEventToRoom } from "../src/utils/socket.util.js";

const ACTOR_ID = "actor-user";
const SENDER_ID = "sender-user";
const REQUEST_ID = "request-1";
const DELETED_REQUEST_ID = "deleted-request-1";
const CHAT_ID = "chat-1";
const io = { marker: "socket-server" };

const pendingRequest = ({
  receiverId = ACTOR_ID,
}: {
  receiverId?: string;
} = {}) => ({
  id: REQUEST_ID,
  senderId: SENDER_ID,
  receiverId,
});

const newChat = {
  id: CHAT_ID,
  ChatMembers: [],
  UnreadMessages: [],
  latestMessage: null,
};

const authenticatedRequest = (overrides: Record<string, unknown> = {}) => ({
  user: { id: ACTOR_ID, username: "actor" },
  params: { id: REQUEST_ID },
  body: { action: "accept" },
  app: { get: vi.fn(() => io) },
  ...overrides,
} as unknown as AuthenticatedRequest);

const responseRecorder = () => {
  const status = vi.fn();
  const json = vi.fn();
  const setHeader = vi.fn();
  const response = { status, json, setHeader } as unknown as Response;
  status.mockReturnValue(response);
  json.mockReturnValue(response);
  return { response, status, json, setHeader };
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

const expectedChatCreateArguments = () => ({
  data: {
    ChatMembers: {
      create: [
        { user: { connect: { id: SENDER_ID } } },
        { user: { connect: { id: ACTOR_ID } } },
      ],
    },
  },
  omit: {
    avatarCloudinaryPublicId: true,
  },
  include: {
    ChatMembers: {
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatar: true,
            isOnline: true,
            publicKey: true,
            lastSeen: true,
            verificationBadge: true,
          },
        },
      },
      omit: {
        chatId: true,
        userId: true,
        id: true,
      },
    },
    UnreadMessages: {
      where: {
        userId: ACTOR_ID,
      },
      select: {
        count: true,
        message: {
          select: {
            isTextMessage: true,
            url: true,
            attachments: {
              select: {
                secureUrl: true,
              },
            },
            isPollMessage: true,
            createdAt: true,
            textMessageContent: true,
          },
        },
        sender: {
          select: {
            id: true,
            username: true,
            avatar: true,
            isOnline: true,
            publicKey: true,
            lastSeen: true,
            verificationBadge: true,
          },
        },
      },
    },
    latestMessage: {
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
        poll: true,
        reactions: {
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
            createdAt: true,
            updatedAt: true,
            userId: true,
            messageId: true,
          },
        },
      },
    },
  },
});

const friendshipResult = ({
  fcmToken = "sender-fcm-token",
  notificationsEnabled = true,
  senderAsUser2 = false,
}: {
  fcmToken?: string | null;
  notificationsEnabled?: boolean;
  senderAsUser2?: boolean;
} = {}) => {
  const sender = { id: SENDER_ID, fcmToken, notificationsEnabled };
  const actor = { id: ACTOR_ID, fcmToken: null, notificationsEnabled: false };
  return senderAsUser2
    ? { user1: actor, user2: sender }
    : { user1: sender, user2: actor };
};

const arrangeAcceptedRequest = ({
  friendship = friendshipResult(),
}: {
  friendship?: ReturnType<typeof friendshipResult>;
} = {}) => {
  vi.mocked(prisma.friendRequest.findFirst).mockResolvedValue(pendingRequest() as never);
  vi.mocked(prisma.chat.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.chat.create).mockResolvedValue(newChat as never);
  vi.mocked(prisma.friends.create).mockResolvedValue(friendship as never);
  vi.mocked(prisma.friendRequest.delete).mockResolvedValue(pendingRequest() as never);
};

describe("friend-request handle pre-extraction characterization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(enforcePairRateLimit).mockReturnValue(true);
  });

  it("looks up the requested ID and returns the concealed 404 when it is missing", async () => {
    vi.mocked(prisma.friendRequest.findFirst).mockResolvedValue(null);
    const next = vi.fn();
    const recorder = responseRecorder();

    await handleRequest(authenticatedRequest(), recorder.response, next as NextFunction);

    expect(prisma.friendRequest.findFirst).toHaveBeenCalledWith({ where: { id: REQUEST_ID } });
    expectError(next, 404, "Request not found");
    expect(enforcePairRateLimit).not.toHaveBeenCalled();
    expect(prisma.chat.findFirst).not.toHaveBeenCalled();
    expect(prisma.friendRequest.delete).not.toHaveBeenCalled();
    expect(recorder.status).not.toHaveBeenCalled();
  });

  it("returns the same concealed 404 when the authenticated actor is not the receiver", async () => {
    vi.mocked(prisma.friendRequest.findFirst).mockResolvedValue(
      pendingRequest({ receiverId: "different-receiver" }) as never,
    );
    const next = vi.fn();
    const recorder = responseRecorder();

    await handleRequest(authenticatedRequest(), recorder.response, next as NextFunction);

    expect(prisma.friendRequest.findFirst).toHaveBeenCalledWith({ where: { id: REQUEST_ID } });
    expectError(next, 404, "Request not found");
    expect(enforcePairRateLimit).not.toHaveBeenCalled();
    expect(prisma.chat.findFirst).not.toHaveBeenCalled();
    expect(prisma.friendRequest.delete).not.toHaveBeenCalled();
    expect(recorder.status).not.toHaveBeenCalled();
  });

  it.each(["accept", "reject"] as const)(
    "applies handle rate limiting after lookup and receiver authorization but before %s mutation",
    async (action) => {
      vi.mocked(prisma.friendRequest.findFirst).mockResolvedValue(pendingRequest() as never);
      vi.mocked(enforcePairRateLimit).mockReturnValue(false);
      const next = vi.fn();
      const recorder = responseRecorder();

      await handleRequest(
        authenticatedRequest({ body: { action } }),
        recorder.response,
        next as NextFunction,
      );

      expect(enforcePairRateLimit).toHaveBeenCalledTimes(1);
      expect(enforcePairRateLimit).toHaveBeenCalledWith({
        response: recorder.response,
        next,
        actorUserId: ACTOR_ID,
        otherUserId: SENDER_ID,
        policy: BACKEND_RATE_LIMITS.friendHandle,
      });
      expectCalledBefore(
        vi.mocked(prisma.friendRequest.findFirst) as unknown as ReturnType<typeof vi.fn>,
        vi.mocked(enforcePairRateLimit),
      );
      expect(prisma.chat.findFirst).not.toHaveBeenCalled();
      expect(prisma.chat.create).not.toHaveBeenCalled();
      expect(prisma.friends.create).not.toHaveBeenCalled();
      expect(prisma.friendRequest.delete).not.toHaveBeenCalled();
      expect(recorder.status).not.toHaveBeenCalled();
    },
  );

  it("checks for the exact private-chat predicate and returns the existing-chat 400", async () => {
    vi.mocked(prisma.friendRequest.findFirst).mockResolvedValue(pendingRequest() as never);
    vi.mocked(prisma.chat.findFirst).mockResolvedValue({ id: "existing-chat" } as never);
    const next = vi.fn();
    const recorder = responseRecorder();

    await handleRequest(authenticatedRequest(), recorder.response, next as NextFunction);

    expect(prisma.chat.findFirst).toHaveBeenCalledWith({
      where: {
        isGroupChat: false,
        ChatMembers: {
          every: {
            userId: { in: [SENDER_ID, ACTOR_ID] },
          },
        },
      },
    });
    expectError(next, 400, "Your private chat already exists");
    expect(prisma.chat.create).not.toHaveBeenCalled();
    expect(prisma.friends.create).not.toHaveBeenCalled();
    expect(prisma.friendRequest.delete).not.toHaveBeenCalled();
    expect(joinMembersInChatRoom).not.toHaveBeenCalled();
    expect(emitEventToRoom).not.toHaveBeenCalled();
    expect(recorder.status).not.toHaveBeenCalled();
  });

  it("preserves the full accept write shapes, sender fallback, exact push, realtime, response, and order", async () => {
    arrangeAcceptedRequest({
      friendship: friendshipResult({ senderAsUser2: true }),
    });
    const next = vi.fn();
    const recorder = responseRecorder();

    await handleRequest(authenticatedRequest(), recorder.response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(prisma.chat.create).toHaveBeenCalledWith(expectedChatCreateArguments());
    expect(prisma.friends.create).toHaveBeenCalledWith({
      data: {
        user1: { connect: { id: SENDER_ID } },
        user2: { connect: { id: ACTOR_ID } },
      },
      include: {
        user1: true,
        user2: true,
      },
    });
    expect(sendPushNotification).toHaveBeenCalledWith({
      recipientToken: "sender-fcm-token",
      body: "actor has accepted your friend request 😃",
    });
    expect(joinMembersInChatRoom).toHaveBeenCalledWith({
      directory: io,
      io,
      memberIds: [SENDER_ID, ACTOR_ID],
      roomToJoin: CHAT_ID,
    });
    expect(prisma.friendRequest.delete).toHaveBeenCalledWith({ where: { id: REQUEST_ID } });
    expect(emitEventToRoom).toHaveBeenCalledWith({
      data: { ...newChat, typingUsers: [] },
      event: Events.NEW_CHAT,
      io,
      room: CHAT_ID,
    });
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith({ id: REQUEST_ID });

    expectCalledBefore(
      vi.mocked(prisma.chat.findFirst) as unknown as ReturnType<typeof vi.fn>,
      vi.mocked(prisma.chat.create) as unknown as ReturnType<typeof vi.fn>,
    );
    expectCalledBefore(
      vi.mocked(prisma.chat.create) as unknown as ReturnType<typeof vi.fn>,
      vi.mocked(prisma.friends.create) as unknown as ReturnType<typeof vi.fn>,
    );
    expectCalledBefore(
      vi.mocked(prisma.friends.create) as unknown as ReturnType<typeof vi.fn>,
      vi.mocked(sendPushNotification),
    );
    expectCalledBefore(vi.mocked(sendPushNotification), vi.mocked(joinMembersInChatRoom));
    expectCalledBefore(
      vi.mocked(joinMembersInChatRoom),
      vi.mocked(prisma.friendRequest.delete) as unknown as ReturnType<typeof vi.fn>,
    );
    expectCalledBefore(
      vi.mocked(prisma.friendRequest.delete) as unknown as ReturnType<typeof vi.fn>,
      vi.mocked(emitEventToRoom),
    );
    expectCalledBefore(vi.mocked(emitEventToRoom), recorder.status);
    expectCalledBefore(recorder.status, recorder.json);
  });

  it.each([
    ["notifications disabled", { notificationsEnabled: false, fcmToken: "sender-fcm-token" }],
    ["missing token", { notificationsEnabled: true, fcmToken: null }],
  ] as const)("skips accept push for %s but preserves later side effects and response", async (_case, state) => {
    arrangeAcceptedRequest({ friendship: friendshipResult(state) });
    const recorder = responseRecorder();

    await handleRequest(authenticatedRequest(), recorder.response, vi.fn() as NextFunction);

    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(joinMembersInChatRoom).toHaveBeenCalledWith({
      directory: io,
      io,
      memberIds: [SENDER_ID, ACTOR_ID],
      roomToJoin: CHAT_ID,
    });
    expect(prisma.friendRequest.delete).toHaveBeenCalledWith({ where: { id: REQUEST_ID } });
    expect(emitEventToRoom).toHaveBeenCalledWith({
      data: { ...newChat, typingUsers: [] },
      event: Events.NEW_CHAT,
      io,
      room: CHAT_ID,
    });
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith({ id: REQUEST_ID });
  });

  it("stops accept after chat creation fails", async () => {
    const failure = new Error("chat create failed");
    vi.mocked(prisma.friendRequest.findFirst).mockResolvedValue(pendingRequest() as never);
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.chat.create).mockRejectedValue(failure);
    const next = vi.fn();
    const recorder = responseRecorder();

    await handleRequest(authenticatedRequest(), recorder.response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(failure);
    expect(prisma.friends.create).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(joinMembersInChatRoom).not.toHaveBeenCalled();
    expect(prisma.friendRequest.delete).not.toHaveBeenCalled();
    expect(emitEventToRoom).not.toHaveBeenCalled();
    expect(recorder.status).not.toHaveBeenCalled();
  });

  it("stops accept after friendship creation fails while retaining the chat write", async () => {
    const failure = new Error("friendship create failed");
    vi.mocked(prisma.friendRequest.findFirst).mockResolvedValue(pendingRequest() as never);
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.chat.create).mockResolvedValue(newChat as never);
    vi.mocked(prisma.friends.create).mockRejectedValue(failure);
    const next = vi.fn();
    const recorder = responseRecorder();

    await handleRequest(authenticatedRequest(), recorder.response, next as NextFunction);

    expect(prisma.chat.create).toHaveBeenCalledWith(expectedChatCreateArguments());
    expect(next).toHaveBeenCalledWith(failure);
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(joinMembersInChatRoom).not.toHaveBeenCalled();
    expect(prisma.friendRequest.delete).not.toHaveBeenCalled();
    expect(emitEventToRoom).not.toHaveBeenCalled();
    expect(recorder.status).not.toHaveBeenCalled();
  });

  it("retains chat, friendship, eligible push, and room join when accept deletion fails", async () => {
    const failure = new Error("request delete failed");
    arrangeAcceptedRequest();
    vi.mocked(prisma.friendRequest.delete).mockRejectedValue(failure);
    const next = vi.fn();
    const recorder = responseRecorder();

    await handleRequest(authenticatedRequest(), recorder.response, next as NextFunction);

    expect(prisma.chat.create).toHaveBeenCalledTimes(1);
    expect(prisma.friends.create).toHaveBeenCalledTimes(1);
    expect(sendPushNotification).toHaveBeenCalledWith({
      recipientToken: "sender-fcm-token",
      body: "actor has accepted your friend request 😃",
    });
    expect(joinMembersInChatRoom).toHaveBeenCalledWith({
      directory: io,
      io,
      memberIds: [SENDER_ID, ACTOR_ID],
      roomToJoin: CHAT_ID,
    });
    expect(next).toHaveBeenCalledWith(failure);
    expect(emitEventToRoom).not.toHaveBeenCalled();
    expect(recorder.status).not.toHaveBeenCalled();
    expect(recorder.json).not.toHaveBeenCalled();
    expectCalledBefore(
      vi.mocked(prisma.friends.create) as unknown as ReturnType<typeof vi.fn>,
      vi.mocked(sendPushNotification),
    );
    expectCalledBefore(vi.mocked(sendPushNotification), vi.mocked(joinMembersInChatRoom));
    expectCalledBefore(
      vi.mocked(joinMembersInChatRoom),
      vi.mocked(prisma.friendRequest.delete) as unknown as ReturnType<typeof vi.fn>,
    );
  });

  it("rejects with the exact delete shape and push text, then returns the deleted ID", async () => {
    vi.mocked(prisma.friendRequest.findFirst).mockResolvedValue(pendingRequest() as never);
    vi.mocked(prisma.friendRequest.delete).mockResolvedValue({
      id: DELETED_REQUEST_ID,
      sender: {
        isOnline: false,
        fcmToken: "sender-fcm-token",
        notificationsEnabled: true,
      },
    } as never);
    const next = vi.fn();
    const recorder = responseRecorder();

    await handleRequest(
      authenticatedRequest({ body: { action: "reject" } }),
      recorder.response,
      next as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();
    expect(prisma.friendRequest.delete).toHaveBeenCalledWith({
      where: { id: REQUEST_ID },
      include: {
        sender: {
          select: {
            isOnline: true,
            fcmToken: true,
            notificationsEnabled: true,
          },
        },
      },
    });
    expect(sendPushNotification).toHaveBeenCalledWith({
      recipientToken: "sender-fcm-token",
      body: "actor has rejected your friend request ☹️",
    });
    expect(prisma.chat.findFirst).not.toHaveBeenCalled();
    expect(prisma.chat.create).not.toHaveBeenCalled();
    expect(prisma.friends.create).not.toHaveBeenCalled();
    expect(joinMembersInChatRoom).not.toHaveBeenCalled();
    expect(emitEventToRoom).not.toHaveBeenCalled();
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith({ id: DELETED_REQUEST_ID });
    expectCalledBefore(
      vi.mocked(prisma.friendRequest.delete) as unknown as ReturnType<typeof vi.fn>,
      vi.mocked(sendPushNotification),
    );
    expectCalledBefore(vi.mocked(sendPushNotification), recorder.status);
    expectCalledBefore(recorder.status, recorder.json);
  });

  it.each([
    ["notifications disabled", { notificationsEnabled: false, fcmToken: "sender-fcm-token" }],
    ["missing token", { notificationsEnabled: true, fcmToken: null }],
  ] as const)("skips reject push for %s and still returns the deleted ID", async (_case, sender) => {
    vi.mocked(prisma.friendRequest.findFirst).mockResolvedValue(pendingRequest() as never);
    vi.mocked(prisma.friendRequest.delete).mockResolvedValue({
      id: DELETED_REQUEST_ID,
      sender: { isOnline: false, ...sender },
    } as never);
    const recorder = responseRecorder();

    await handleRequest(
      authenticatedRequest({ body: { action: "reject" } }),
      recorder.response,
      vi.fn() as NextFunction,
    );

    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(joinMembersInChatRoom).not.toHaveBeenCalled();
    expect(emitEventToRoom).not.toHaveBeenCalled();
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith({ id: DELETED_REQUEST_ID });
  });

  it("stops reject after deletion fails without push, realtime, or response", async () => {
    const failure = new Error("reject delete failed");
    vi.mocked(prisma.friendRequest.findFirst).mockResolvedValue(pendingRequest() as never);
    vi.mocked(prisma.friendRequest.delete).mockRejectedValue(failure);
    const next = vi.fn();
    const recorder = responseRecorder();

    await handleRequest(
      authenticatedRequest({ body: { action: "reject" } }),
      recorder.response,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledWith(failure);
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(prisma.chat.findFirst).not.toHaveBeenCalled();
    expect(prisma.chat.create).not.toHaveBeenCalled();
    expect(prisma.friends.create).not.toHaveBeenCalled();
    expect(joinMembersInChatRoom).not.toHaveBeenCalled();
    expect(emitEventToRoom).not.toHaveBeenCalled();
    expect(recorder.status).not.toHaveBeenCalled();
    expect(recorder.json).not.toHaveBeenCalled();
  });
});
