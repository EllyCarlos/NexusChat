import type { NextFunction, RequestHandler, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  avatarUploadRateLimit: vi.fn(),
  authorizeGroupChatUpload: vi.fn(),
  createChatUpload: vi.fn(),
  fileValidation: vi.fn(),
  groupChatUpload: vi.fn(),
  uploadCleanupBoundary: vi.fn(),
  validation: vi.fn(),
  verifyToken: vi.fn(),
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    chat: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../src/services/authorization.service.js", () => ({
  assertChatAdmin: vi.fn(),
  getCachedAuthorizedChat: vi.fn(),
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

vi.mock("../src/middlewares/multer.middleware.js", () => ({
  createChatUpload: {
    single: vi.fn(() => routeMocks.createChatUpload),
  },
  groupChatUpload: {
    single: vi.fn(() => routeMocks.groupChatUpload),
  },
}));

vi.mock("../src/middlewares/rate-limit.middleware.js", () => ({
  avatarUploadRateLimit: routeMocks.avatarUploadRateLimit,
}));

vi.mock("../src/middlewares/file-validation.middleware.js", () => ({
  fileValidation: routeMocks.fileValidation,
}));

vi.mock("../src/middlewares/upload-authorization.middleware.js", () => ({
  authorizeGroupChatUpload: routeMocks.authorizeGroupChatUpload,
}));

vi.mock("../src/middlewares/validate.middleware.js", () => ({
  validate: vi.fn(() => routeMocks.validation),
}));

vi.mock("../src/middlewares/verify-token.middleware.js", () => ({
  verifyToken: routeMocks.verifyToken,
}));

vi.mock("../src/utils/upload-lifecycle.util.js", () => ({
  cleanupTemporaryFiles: vi.fn(async () => undefined),
  uploadCleanupBoundary: routeMocks.uploadCleanupBoundary,
}));

import { getUserChats } from "../src/controllers/chat.controller.js";
import type { AuthenticatedRequest } from "../src/interfaces/auth/auth.interface.js";
import { prisma } from "../src/lib/prisma.lib.js";
import { verifyToken } from "../src/middlewares/verify-token.middleware.js";
import chatRouter from "../src/routes/chat.router.js";

const ACTOR_ID = "authenticated-user";

const request = () => ({
  user: {
    id: ACTOR_ID,
    username: "authenticated",
  },
  body: { userId: "attacker-controlled-user" },
  params: { id: "attacker-controlled-chat" },
  query: { userId: "attacker-controlled-user" },
} as unknown as AuthenticatedRequest);

const responseRecorder = () => {
  const status = vi.fn();
  const json = vi.fn();
  const response = { status, json } as unknown as Response;
  status.mockReturnValue(response);
  json.mockReturnValue(response);
  return { response, status, json };
};

const expectedChatListQuery = {
  where: {
    ChatMembers: {
      some: {
        userId: ACTOR_ID,
      },
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
};

type RouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
};

const routeLayers = () => (
  chatRouter as unknown as { stack: RouterLayer[] }
).stack.filter((layer): layer is Required<Pick<RouterLayer, "route">> => Boolean(layer.route));

describe("chat-list query characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.chat.findMany).mockResolvedValue([]);
  });

  it("uses the authenticated actor and the exact current Prisma projection without ordering or pagination", async () => {
    const recorder = responseRecorder();

    await getUserChats(request(), recorder.response, vi.fn() as NextFunction);

    expect(prisma.chat.findMany).toHaveBeenCalledOnce();
    expect(prisma.chat.findMany).toHaveBeenCalledWith(expectedChatListQuery);

    const query = vi.mocked(prisma.chat.findMany).mock.calls[0]?.[0];
    expect(query?.include?.UnreadMessages).not.toHaveProperty("where");
    expect(query).not.toHaveProperty("orderBy");
    expect(query).not.toHaveProperty("skip");
    expect(query).not.toHaveProperty("take");
  });

  it("adds a distinct empty typingUsers array to every chat without mutating repository records", async () => {
    const firstChat = {
      id: "chat-1",
      name: "First chat",
      ChatMembers: [{ user: { id: "member-1", username: "one" } }],
      UnreadMessages: [],
      latestMessage: null,
    };
    const secondChat = {
      id: "chat-2",
      name: "Second chat",
      ChatMembers: [{ user: { id: "member-2", username: "two" } }],
      UnreadMessages: [{ count: 1 }],
      latestMessage: { id: "message-2" },
    };
    vi.mocked(prisma.chat.findMany).mockResolvedValue([firstChat, secondChat] as never);
    const recorder = responseRecorder();

    await getUserChats(request(), recorder.response, vi.fn() as NextFunction);

    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith([
      { ...firstChat, typingUsers: [] },
      { ...secondChat, typingUsers: [] },
    ]);

    const [payload] = recorder.json.mock.calls[0] as [{ typingUsers: unknown[] }[]];
    expect(payload[0]).not.toBe(firstChat);
    expect(payload[1]).not.toBe(secondChat);
    expect(payload[0]?.typingUsers).not.toBe(payload[1]?.typingUsers);
    expect(firstChat).not.toHaveProperty("typingUsers");
    expect(secondChat).not.toHaveProperty("typingUsers");
  });

  it("returns an empty array with the exact current HTTP response", async () => {
    const recorder = responseRecorder();

    await getUserChats(request(), recorder.response, vi.fn() as NextFunction);

    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith([]);
  });

  it("forwards the original repository error without starting a response", async () => {
    const databaseError = new Error("chat list unavailable");
    vi.mocked(prisma.chat.findMany).mockRejectedValue(databaseError);
    const recorder = responseRecorder();
    const next = vi.fn();

    await getUserChats(request(), recorder.response, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(databaseError);
    expect(recorder.status).not.toHaveBeenCalled();
    expect(recorder.json).not.toHaveBeenCalled();
  });
});

describe("chat-list route characterization", () => {
  it("keeps GET / authenticated with verifyToken immediately before getUserChats", () => {
    const getRoute = routeLayers().find(({ route }) => (
      route.path === "/" && route.methods.get
    ));

    expect(getRoute).toBeDefined();
    expect(getRoute?.route.stack.map(({ handle }) => handle)).toEqual([
      verifyToken,
      getUserChats,
    ]);
  });
});
