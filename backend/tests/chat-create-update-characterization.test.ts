import type { NextFunction, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertChatAdmin: vi.fn(),
  chatFindFirst: vi.fn(),
  chatFindUnique: vi.fn(),
  chatUpdate: vi.fn(),
  cleanupTemporaryFiles: vi.fn(async () => undefined),
  deleteFilesFromCloudinary: vi.fn(async () => undefined),
  emitEvent: vi.fn(),
  emitEventToRoom: vi.fn(),
  joinMembersInChatRoom: vi.fn(),
  disconnectMembersFromChatRoom: vi.fn(),
  logServerError: vi.fn(),
  transaction: vi.fn(),
  transactionChatCreate: vi.fn(),
  transactionMembersCreateMany: vi.fn(),
  uploadFilesToCloudinary: vi.fn(),
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    $transaction: mocks.transaction,
    chat: {
      findFirst: mocks.chatFindFirst,
      findUnique: mocks.chatFindUnique,
      update: mocks.chatUpdate,
    },
  },
}));

vi.mock("../src/services/authorization.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/authorization.service.js")>();
  return {
    ...actual,
    assertChatAdmin: mocks.assertChatAdmin,
  };
});

vi.mock("../src/modules/read-queries/read-query.service.js", () => ({
  getUserChatsQuery: vi.fn(),
}));

vi.mock("../src/utils/auth.util.js", () => ({
  deleteFilesFromCloudinary: mocks.deleteFilesFromCloudinary,
  uploadFilesToCloudinary: mocks.uploadFilesToCloudinary,
}));

vi.mock("../src/utils/chat.util.js", () => ({
  disconnectMembersFromChatRoom: mocks.disconnectMembersFromChatRoom,
  joinMembersInChatRoom: mocks.joinMembersInChatRoom,
}));

vi.mock("../src/utils/socket.util.js", () => ({
  emitEvent: mocks.emitEvent,
  emitEventToRoom: mocks.emitEventToRoom,
}));

vi.mock("../src/utils/safe-logger.utils.js", () => ({
  logServerError: mocks.logServerError,
}));

vi.mock("../src/utils/upload-lifecycle.util.js", () => ({
  cleanupTemporaryFiles: mocks.cleanupTemporaryFiles,
}));

import { DEFAULT_AVATAR } from "../src/constants/file.constant.js";
import {
  createChat,
  updateChat,
} from "../src/controllers/chat.controller.js";
import { Events } from "../src/enums/event/event.enum.js";
import type { AuthenticatedRequest } from "../src/interfaces/auth/auth.interface.js";
import {
  cacheAuthorizedChat,
} from "../src/services/authorization.service.js";
import { CustomError } from "../src/utils/error.utils.js";

const ACTOR_ID = "actor-user";
const CHAT_ID = "chat-1";
const OLD_AVATAR_ID = "old-avatar-id";
const NEW_AVATAR_ID = "new-avatar-id";
const NEW_AVATAR_URL = "https://media.example/new-group-avatar.png";
const io = { marker: "socket-server" };

const avatarFile = {
  path: "temporary-group-avatar",
} as Express.Multer.File;

const authorizedChat = ({
  adminId = ACTOR_ID,
  avatarCloudinaryPublicId = OLD_AVATAR_ID,
  id = CHAT_ID,
  isGroupChat = true,
}: {
  adminId?: string;
  avatarCloudinaryPublicId?: string | null;
  id?: string;
  isGroupChat?: boolean;
} = {}) => ({
  id,
  isGroupChat,
  adminId,
  avatarCloudinaryPublicId,
  ChatMembers: [{ userId: ACTOR_ID }],
});

const populatedChat = {
  id: CHAT_ID,
  name: "Architecture",
  avatar: DEFAULT_AVATAR,
  ChatMembers: [{ user: { id: ACTOR_ID, username: "actor" } }],
  UnreadMessages: [],
  latestMessage: null,
};

const expectedCreatedChatQuery = {
  where: { id: CHAT_ID },
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
};

const request = (overrides: Record<string, unknown> = {}) => ({
  user: {
    id: ACTOR_ID,
    username: "actor",
  },
  params: { id: CHAT_ID },
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

const expectBefore = (
  first: ReturnType<typeof vi.fn>,
  second: ReturnType<typeof vi.fn>,
) => {
  expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0]);
};

const expectPublicError = (
  next: ReturnType<typeof vi.fn>,
  statusCode: number,
  message: string,
) => {
  expect(next).toHaveBeenCalledOnce();
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode, message }));
};

const expectNoResponse = (recorder: ReturnType<typeof responseRecorder>) => {
  expect(recorder.status).not.toHaveBeenCalled();
  expect(recorder.json).not.toHaveBeenCalled();
};

const successfulUpload = () => ({
  public_id: NEW_AVATAR_ID,
  secure_url: NEW_AVATAR_URL,
});

beforeEach(() => {
  vi.clearAllMocks();

  mocks.transactionChatCreate.mockResolvedValue({ id: CHAT_ID });
  mocks.transactionMembersCreateMany.mockResolvedValue({ count: 3 });
  mocks.transaction.mockImplementation(async (operation: unknown) => (
    (operation as (transaction: unknown) => Promise<unknown>)({
      chat: { create: mocks.transactionChatCreate },
      chatMembers: { createMany: mocks.transactionMembersCreateMany },
    })
  ));
  mocks.chatFindUnique.mockResolvedValue(populatedChat);
  mocks.chatUpdate.mockResolvedValue({
    id: CHAT_ID,
    name: "Architecture",
    avatar: NEW_AVATAR_URL,
  });
  mocks.assertChatAdmin.mockResolvedValue(authorizedChat());
  mocks.uploadFilesToCloudinary.mockResolvedValue([successfulUpload()]);
  mocks.deleteFilesFromCloudinary.mockResolvedValue(undefined);
  mocks.cleanupTemporaryFiles.mockResolvedValue(undefined);
  mocks.joinMembersInChatRoom.mockImplementation(() => undefined);
  mocks.emitEvent.mockImplementation(() => undefined);
  mocks.emitEventToRoom.mockImplementation(() => undefined);
});

describe("createChat pre-extraction characterization", () => {
  it("rejects non-group creation with the exact public error before media, persistence, or realtime", async () => {
    const recorder = responseRecorder();
    const next = vi.fn();

    await createChat(request({
      body: {
        isGroupChat: "false",
        members: ["member-1", "member-2"],
        name: "Direct chat",
      },
    }), recorder.response, next as NextFunction);

    expectPublicError(next, 400, "Only group chats can be created through this endpoint");
    expect(mocks.uploadFilesToCloudinary).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.joinMembersInChatRoom).not.toHaveBeenCalled();
    expect(mocks.emitEventToRoom).not.toHaveBeenCalled();
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([]);
    expectNoResponse(recorder);
  });

  it("checks the exact supplied-member minimum before media upload and cleans the temporary file", async () => {
    const recorder = responseRecorder();
    const next = vi.fn();

    await createChat(request({
      body: {
        isGroupChat: "true",
        members: ["member-1"],
        name: "Too small",
      },
      file: avatarFile,
    }), recorder.response, next as NextFunction);

    expectPublicError(next, 400, "Atleast 2 members are required to create group chat");
    expect(mocks.uploadFilesToCloudinary).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([avatarFile]);
    expectNoResponse(recorder);
  });

  it("checks the exact name requirement after the member minimum and before media upload", async () => {
    const recorder = responseRecorder();
    const next = vi.fn();

    await createChat(request({
      body: {
        isGroupChat: "true",
        members: ["member-1", "member-2"],
      },
      file: avatarFile,
    }), recorder.response, next as NextFunction);

    expectPublicError(next, 400, "name is required for creating group chat");
    expect(mocks.uploadFilesToCloudinary).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([avatarFile]);
    expectNoResponse(recorder);
  });

  it("uses the default avatar, preserves supplied duplicates, appends the actor, and freezes the exact populated projection", async () => {
    const recorder = responseRecorder();
    const next = vi.fn();
    const suppliedMembers = ["member-1", ACTOR_ID, "member-1"];
    const expectedMemberIds = [...suppliedMembers, ACTOR_ID];

    await createChat(request({
      body: {
        isGroupChat: "true",
        members: suppliedMembers,
        name: "Architecture",
      },
    }), recorder.response, next as NextFunction);

    expect(mocks.uploadFilesToCloudinary).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.transactionChatCreate).toHaveBeenCalledWith({
      data: {
        avatar: DEFAULT_AVATAR,
        avatarCloudinaryPublicId: null,
        isGroupChat: true,
        adminId: ACTOR_ID,
        name: "Architecture",
      },
      select: { id: true },
    });
    expect(mocks.transactionMembersCreateMany).toHaveBeenCalledWith({
      data: expectedMemberIds.map((userId) => ({ chatId: CHAT_ID, userId })),
    });
    expect(mocks.chatFindUnique).toHaveBeenCalledWith(expectedCreatedChatQuery);
    expect(mocks.joinMembersInChatRoom).toHaveBeenCalledWith({
      directory: io,
      memberIds: expectedMemberIds,
      roomToJoin: CHAT_ID,
      io,
    });
    const payload = { ...populatedChat, typingUsers: [] };
    expect(mocks.emitEventToRoom).toHaveBeenCalledWith({
      event: Events.NEW_CHAT,
      io,
      room: CHAT_ID,
      data: payload,
    });
    expectBefore(mocks.transactionChatCreate, mocks.transactionMembersCreateMany);
    expectBefore(mocks.transactionMembersCreateMany, mocks.chatFindUnique);
    expectBefore(mocks.chatFindUnique, mocks.joinMembersInChatRoom);
    expectBefore(mocks.joinMembersInChatRoom, mocks.emitEventToRoom);
    expectBefore(mocks.emitEventToRoom, recorder.status);
    expect(recorder.status).toHaveBeenCalledWith(201);
    expect(recorder.json).toHaveBeenCalledWith(payload);
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([]);
    expect(next).not.toHaveBeenCalled();
  });

  it("uploads a custom avatar before the transaction and persists both provider fields exactly", async () => {
    const recorder = responseRecorder();

    await createChat(request({
      body: {
        isGroupChat: "true",
        members: ["member-1", "member-2"],
        name: "Architecture",
      },
      file: avatarFile,
    }), recorder.response, vi.fn() as NextFunction);

    expect(mocks.uploadFilesToCloudinary).toHaveBeenCalledWith({ files: [avatarFile] });
    expect(mocks.transactionChatCreate).toHaveBeenCalledWith({
      data: {
        avatar: NEW_AVATAR_URL,
        avatarCloudinaryPublicId: NEW_AVATAR_ID,
        isGroupChat: true,
        adminId: ACTOR_ID,
        name: "Architecture",
      },
      select: { id: true },
    });
    expectBefore(mocks.uploadFilesToCloudinary, mocks.transactionChatCreate);
    expect(mocks.deleteFilesFromCloudinary).not.toHaveBeenCalled();
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([avatarFile]);
  });

  it("maps a missing upload result to the generic create failure without starting persistence", async () => {
    mocks.uploadFilesToCloudinary.mockResolvedValue([]);
    const recorder = responseRecorder();
    const next = vi.fn();

    await createChat(request({
      body: {
        isGroupChat: "true",
        members: ["member-1", "member-2"],
        name: "Architecture",
      },
      file: avatarFile,
    }), recorder.response, next as NextFunction);

    expectPublicError(next, 500, "Failed to create group chat");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.deleteFilesFromCloudinary).not.toHaveBeenCalled();
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([avatarFile]);
    expectNoResponse(recorder);
  });

  it("stops inside the transaction when chat creation fails and rolls back the uploaded avatar", async () => {
    mocks.transactionChatCreate.mockRejectedValue(new Error("chat create internals"));
    const recorder = responseRecorder();
    const next = vi.fn();

    await createChat(request({
      body: {
        isGroupChat: "true",
        members: ["member-1", "member-2"],
        name: "Architecture",
      },
      file: avatarFile,
    }), recorder.response, next as NextFunction);

    expect(mocks.transactionMembersCreateMany).not.toHaveBeenCalled();
    expect(mocks.chatFindUnique).not.toHaveBeenCalled();
    expect(mocks.deleteFilesFromCloudinary).toHaveBeenCalledWith({
      publicIds: [NEW_AVATAR_ID],
    });
    expectPublicError(next, 500, "Failed to create group chat");
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([avatarFile]);
    expectNoResponse(recorder);
  });

  it("keeps member creation inside the transaction and rolls back the avatar when that write fails", async () => {
    mocks.transactionMembersCreateMany.mockRejectedValue(new Error("member create internals"));
    const recorder = responseRecorder();
    const next = vi.fn();

    await createChat(request({
      body: {
        isGroupChat: "true",
        members: ["member-1", "member-2"],
        name: "Architecture",
      },
      file: avatarFile,
    }), recorder.response, next as NextFunction);

    expect(mocks.transactionChatCreate).toHaveBeenCalledOnce();
    expect(mocks.transactionMembersCreateMany).toHaveBeenCalledOnce();
    expect(mocks.chatFindUnique).not.toHaveBeenCalled();
    expect(mocks.deleteFilesFromCloudinary).toHaveBeenCalledWith({
      publicIds: [NEW_AVATAR_ID],
    });
    expectPublicError(next, 500, "Failed to create group chat");
    expectNoResponse(recorder);
  });

  it("logs a static safe message when pre-commit avatar rollback rejects and preserves the create failure", async () => {
    const rollbackError = new Error("provider rollback details");
    mocks.transactionChatCreate.mockRejectedValue(new Error("database details"));
    mocks.deleteFilesFromCloudinary.mockRejectedValue(rollbackError);
    const next = vi.fn();

    await createChat(request({
      body: {
        isGroupChat: "true",
        members: ["member-1", "member-2"],
        name: "Architecture",
      },
      file: avatarFile,
    }), responseRecorder().response, next as NextFunction);

    expect(mocks.logServerError).toHaveBeenCalledWith(
      "New group avatar rollback failed.",
      rollbackError,
    );
    expectPublicError(next, 500, "Failed to create group chat");
  });

  it("does not roll back a committed avatar when the populated-chat query fails", async () => {
    mocks.chatFindUnique.mockRejectedValue(new Error("populated query details"));
    const recorder = responseRecorder();
    const next = vi.fn();

    await createChat(request({
      body: {
        isGroupChat: "true",
        members: ["member-1", "member-2"],
        name: "Architecture",
      },
      file: avatarFile,
    }), recorder.response, next as NextFunction);

    expect(mocks.transactionMembersCreateMany).toHaveBeenCalledOnce();
    expect(mocks.deleteFilesFromCloudinary).not.toHaveBeenCalled();
    expect(mocks.joinMembersInChatRoom).not.toHaveBeenCalled();
    expect(mocks.emitEventToRoom).not.toHaveBeenCalled();
    expectPublicError(next, 500, "Failed to create group chat");
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([avatarFile]);
    expectNoResponse(recorder);
  });

  it("stops after a room-join failure without rolling back committed persistence or emitting NEW_CHAT", async () => {
    mocks.joinMembersInChatRoom.mockImplementation(() => {
      throw new Error("room join details");
    });
    const recorder = responseRecorder();
    const next = vi.fn();

    await createChat(request({
      body: {
        isGroupChat: "true",
        members: ["member-1", "member-2"],
        name: "Architecture",
      },
      file: avatarFile,
    }), recorder.response, next as NextFunction);

    expect(mocks.emitEventToRoom).not.toHaveBeenCalled();
    expect(mocks.deleteFilesFromCloudinary).not.toHaveBeenCalled();
    expectPublicError(next, 500, "Failed to create group chat");
    expectNoResponse(recorder);
  });

  it("keeps room membership and the committed avatar when NEW_CHAT emission fails", async () => {
    mocks.emitEventToRoom.mockImplementation(() => {
      throw new Error("socket emit details");
    });
    const recorder = responseRecorder();
    const next = vi.fn();

    await createChat(request({
      body: {
        isGroupChat: "true",
        members: ["member-1", "member-2"],
        name: "Architecture",
      },
      file: avatarFile,
    }), recorder.response, next as NextFunction);

    expect(mocks.joinMembersInChatRoom).toHaveBeenCalledOnce();
    expect(mocks.deleteFilesFromCloudinary).not.toHaveBeenCalled();
    expectPublicError(next, 500, "Failed to create group chat");
    expectNoResponse(recorder);
  });
});

describe("updateChat pre-extraction characterization", () => {
  it("checks the no-name/no-avatar guard before consulting the controller authorization cache", async () => {
    const recorder = responseRecorder();
    const next = vi.fn();

    await updateChat(request(), recorder.response, next as NextFunction);

    expectPublicError(
      next,
      400,
      "Either avatar or name is required for updating a chat, please provide one",
    );
    expect(mocks.assertChatAdmin).not.toHaveBeenCalled();
    expect(mocks.uploadFilesToCloudinary).not.toHaveBeenCalled();
    expect(mocks.chatUpdate).not.toHaveBeenCalled();
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([]);
    expectNoResponse(recorder);
  });

  it("reuses a same-chat group-admin cache entry and performs the exact name-only update", async () => {
    const req = request({ body: { name: "Renamed" } });
    cacheAuthorizedChat(req, authorizedChat() as never);
    const recorder = responseRecorder();

    await updateChat(req, recorder.response, vi.fn() as NextFunction);

    expect(mocks.assertChatAdmin).not.toHaveBeenCalled();
    expect(mocks.uploadFilesToCloudinary).not.toHaveBeenCalled();
    expect(mocks.chatUpdate).toHaveBeenCalledWith({
      where: { id: CHAT_ID },
      data: { name: "Renamed" },
      select: { name: true, avatar: true, id: true },
    });
    expect(mocks.deleteFilesFromCloudinary).not.toHaveBeenCalled();
    expect(mocks.emitEventToRoom).toHaveBeenCalledWith({
      io,
      event: Events.GROUP_CHAT_UPDATE,
      room: CHAT_ID,
      data: {
        chatId: CHAT_ID,
        chatAvatar: NEW_AVATAR_URL,
        chatName: "Architecture",
      },
    });
    expectBefore(mocks.chatUpdate, mocks.emitEventToRoom);
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith({
      id: CHAT_ID,
      name: "Architecture",
      avatar: NEW_AVATAR_URL,
    });
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([]);
  });

  it("uses assertChatAdmin exactly once when no request-scoped cache entry exists", async () => {
    const req = request({ body: { name: "Renamed" } });

    await updateChat(req, responseRecorder().response, vi.fn() as NextFunction);

    expect(mocks.assertChatAdmin).toHaveBeenCalledOnce();
    expect(mocks.assertChatAdmin).toHaveBeenCalledWith(ACTOR_ID, CHAT_ID);
    expectBefore(mocks.assertChatAdmin, mocks.chatUpdate);
  });

  it.each([
    ["another chat", authorizedChat({ id: "chat-2" })],
    ["a non-group chat", authorizedChat({ isGroupChat: false })],
    ["another administrator", authorizedChat({ adminId: "other-admin" })],
  ])("falls back to assertChatAdmin when the cached authorization represents %s", async (_label, cachedChat) => {
    const req = request({ body: { name: "Renamed" } });
    cacheAuthorizedChat(req, cachedChat as never);

    await updateChat(req, responseRecorder().response, vi.fn() as NextFunction);

    expect(mocks.assertChatAdmin).toHaveBeenCalledOnce();
    expect(mocks.assertChatAdmin).toHaveBeenCalledWith(ACTOR_ID, CHAT_ID);
    expectBefore(mocks.assertChatAdmin, mocks.chatUpdate);
  });

  it("performs the exact avatar-only update, cleans the old avatar after commit, then emits and responds", async () => {
    const recorder = responseRecorder();
    const next = vi.fn();

    await updateChat(request({ file: avatarFile }), recorder.response, next as NextFunction);

    expect(mocks.uploadFilesToCloudinary).toHaveBeenCalledWith({ files: [avatarFile] });
    expect(mocks.chatUpdate).toHaveBeenCalledWith({
      where: { id: CHAT_ID },
      data: {
        avatarCloudinaryPublicId: NEW_AVATAR_ID,
        avatar: NEW_AVATAR_URL,
      },
      select: { name: true, avatar: true, id: true },
    });
    expect(mocks.deleteFilesFromCloudinary).toHaveBeenCalledWith({
      publicIds: [OLD_AVATAR_ID],
    });
    expect(mocks.emitEventToRoom).toHaveBeenCalledWith({
      io,
      event: Events.GROUP_CHAT_UPDATE,
      room: CHAT_ID,
      data: {
        chatId: CHAT_ID,
        chatAvatar: NEW_AVATAR_URL,
        chatName: "Architecture",
      },
    });
    expectBefore(mocks.assertChatAdmin, mocks.uploadFilesToCloudinary);
    expectBefore(mocks.uploadFilesToCloudinary, mocks.chatUpdate);
    expectBefore(mocks.chatUpdate, mocks.deleteFilesFromCloudinary);
    expectBefore(mocks.deleteFilesFromCloudinary, mocks.emitEventToRoom);
    expectBefore(mocks.emitEventToRoom, recorder.status);
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith({
      id: CHAT_ID,
      name: "Architecture",
      avatar: NEW_AVATAR_URL,
    });
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([avatarFile]);
    expect(next).not.toHaveBeenCalled();
  });

  it("conditionally combines name and avatar fields without adding undefined values", async () => {
    await updateChat(request({
      body: { name: "Renamed" },
      file: avatarFile,
    }), responseRecorder().response, vi.fn() as NextFunction);

    expect(mocks.chatUpdate).toHaveBeenCalledWith({
      where: { id: CHAT_ID },
      data: {
        avatarCloudinaryPublicId: NEW_AVATAR_ID,
        avatar: NEW_AVATAR_URL,
        name: "Renamed",
      },
      select: { name: true, avatar: true, id: true },
    });
  });

  it("maps a missing avatar upload result to the generic update failure before persistence", async () => {
    mocks.uploadFilesToCloudinary.mockResolvedValue([]);
    const recorder = responseRecorder();
    const next = vi.fn();

    await updateChat(request({ file: avatarFile }), recorder.response, next as NextFunction);

    expect(mocks.chatUpdate).not.toHaveBeenCalled();
    expect(mocks.deleteFilesFromCloudinary).not.toHaveBeenCalled();
    expect(mocks.emitEventToRoom).not.toHaveBeenCalled();
    expectPublicError(next, 500, "Failed to update chat");
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([avatarFile]);
    expectNoResponse(recorder);
  });

  it.each([
    ["there is no previous provider ID", null],
    ["the previous and new provider IDs are equal", NEW_AVATAR_ID],
  ])("skips previous-avatar cleanup when %s", async (_label, previousAvatarId) => {
    mocks.assertChatAdmin.mockResolvedValue(authorizedChat({
      avatarCloudinaryPublicId: previousAvatarId,
    }));

    await updateChat(request({ file: avatarFile }), responseRecorder().response, vi.fn() as NextFunction);

    expect(mocks.chatUpdate).toHaveBeenCalledOnce();
    expect(mocks.deleteFilesFromCloudinary).not.toHaveBeenCalled();
    expect(mocks.emitEventToRoom).toHaveBeenCalledOnce();
  });

  it("safe-logs previous-avatar cleanup rejection and still emits and returns success", async () => {
    const cleanupError = new Error("provider cleanup details");
    mocks.deleteFilesFromCloudinary.mockRejectedValue(cleanupError);
    const recorder = responseRecorder();
    const next = vi.fn();

    await updateChat(request({ file: avatarFile }), recorder.response, next as NextFunction);

    expect(mocks.logServerError).toHaveBeenCalledWith(
      "Previous group avatar cleanup failed.",
      cleanupError,
    );
    expect(mocks.emitEventToRoom).toHaveBeenCalledOnce();
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it("rolls back the new avatar when the non-transactional DB update fails", async () => {
    mocks.chatUpdate.mockRejectedValue(new Error("database update details"));
    const recorder = responseRecorder();
    const next = vi.fn();

    await updateChat(request({ file: avatarFile }), recorder.response, next as NextFunction);

    expect(mocks.deleteFilesFromCloudinary).toHaveBeenCalledWith({
      publicIds: [NEW_AVATAR_ID],
    });
    expect(mocks.deleteFilesFromCloudinary).not.toHaveBeenCalledWith({
      publicIds: [OLD_AVATAR_ID],
    });
    expect(mocks.emitEventToRoom).not.toHaveBeenCalled();
    expectPublicError(next, 500, "Failed to update chat");
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([avatarFile]);
    expectNoResponse(recorder);
  });

  it("safe-logs new-avatar rollback rejection and preserves the original generic update failure", async () => {
    const rollbackError = new Error("provider rollback details");
    mocks.chatUpdate.mockRejectedValue(new Error("database details"));
    mocks.deleteFilesFromCloudinary.mockRejectedValue(rollbackError);
    const next = vi.fn();

    await updateChat(request({ file: avatarFile }), responseRecorder().response, next as NextFunction);

    expect(mocks.logServerError).toHaveBeenCalledWith(
      "New group avatar rollback failed.",
      rollbackError,
    );
    expectPublicError(next, 500, "Failed to update chat");
  });

  it("does not roll back the committed avatar when GROUP_CHAT_UPDATE emission fails", async () => {
    mocks.emitEventToRoom.mockImplementation(() => {
      throw new Error("socket emit details");
    });
    const recorder = responseRecorder();
    const next = vi.fn();

    await updateChat(request({ file: avatarFile }), recorder.response, next as NextFunction);

    expect(mocks.chatUpdate).toHaveBeenCalledOnce();
    expect(mocks.deleteFilesFromCloudinary).toHaveBeenCalledWith({
      publicIds: [OLD_AVATAR_ID],
    });
    expect(mocks.deleteFilesFromCloudinary).not.toHaveBeenCalledWith({
      publicIds: [NEW_AVATAR_ID],
    });
    expectPublicError(next, 500, "Failed to update chat");
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([avatarFile]);
    expectNoResponse(recorder);
  });

  it("preserves assertChatAdmin's CustomError and still cleans a direct-handler temporary file", async () => {
    const authorizationError = new CustomError("Group administrator permission is required", 403);
    mocks.assertChatAdmin.mockRejectedValue(authorizationError);
    const recorder = responseRecorder();
    const next = vi.fn();

    await updateChat(request({ file: avatarFile }), recorder.response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(authorizationError);
    expect(mocks.uploadFilesToCloudinary).not.toHaveBeenCalled();
    expect(mocks.chatUpdate).not.toHaveBeenCalled();
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([avatarFile]);
    expectNoResponse(recorder);
  });
});
