import type { NextFunction, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertChatMember: vi.fn(),
  cleanupTemporaryFiles: vi.fn(async () => undefined),
  deleteFilesFromCloudinary: vi.fn(async () => undefined),
  emitEventToRoom: vi.fn(),
  messageCreate: vi.fn(),
  transaction: vi.fn(),
  unreadUpsert: vi.fn(),
  uploadFilesToCloudinary: vi.fn(),
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    $transaction: mocks.transaction,
    message: { create: mocks.messageCreate },
    unreadMessages: { upsert: mocks.unreadUpsert },
  },
}));

vi.mock("../src/services/authorization.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/authorization.service.js")>();
  return {
    ...actual,
    assertChatMember: mocks.assertChatMember,
  };
});

vi.mock("../src/modules/read-queries/read-query.service.js", () => ({
  getChatAttachmentsQuery: vi.fn(),
}));

vi.mock("../src/utils/auth.util.js", () => ({
  deleteFilesFromCloudinary: mocks.deleteFilesFromCloudinary,
  uploadFilesToCloudinary: mocks.uploadFilesToCloudinary,
}));

vi.mock("../src/utils/socket.util.js", () => ({
  emitEventToRoom: mocks.emitEventToRoom,
}));

vi.mock("../src/utils/upload-lifecycle.util.js", () => ({
  cleanupTemporaryFiles: mocks.cleanupTemporaryFiles,
}));

import { uploadAttachment } from "../src/controllers/attachment.controller.js";
import { Events } from "../src/enums/event/event.enum.js";
import type { AuthenticatedRequest } from "../src/interfaces/auth/auth.interface.js";
import { authorizeAttachmentUpload } from "../src/middlewares/upload-authorization.middleware.js";
import { cacheAuthorizedChat } from "../src/services/authorization.service.js";
import { CustomError } from "../src/utils/error.utils.js";

const ACTOR_ID = "actor-user";
const CHAT_ID = "chat-1";
const io = { marker: "socket-server" };

const firstFile = {
  fieldname: "attachments[]",
  path: "temporary/first-attachment",
} as Express.Multer.File;

const secondFile = {
  fieldname: "attachments[]",
  path: "temporary/second-attachment",
} as Express.Multer.File;

const createdAt = new Date("2025-02-12T09:30:00.000Z");

const authorizedChat = ({
  id = CHAT_ID,
  members = [ACTOR_ID],
}: {
  id?: string;
  members?: string[];
} = {}) => ({
  id,
  isGroupChat: false,
  adminId: null,
  avatarCloudinaryPublicId: null,
  ChatMembers: members.map((userId) => ({ userId })),
});

const newMessage = ({
  attachments = [{ secureUrl: "https://media.example/first.png" }],
}: {
  attachments?: Array<{ secureUrl: string }>;
} = {}) => ({
  id: "message-1",
  attachments,
  createdAt,
  sender: {
    id: ACTOR_ID,
    username: "actor-username",
    avatar: "https://media.example/actor-avatar.png",
  },
  poll: null,
  reactions: [],
});

const request = (overrides: Partial<AuthenticatedRequest> = {}) => ({
  user: { id: ACTOR_ID },
  params: { chatId: CHAT_ID },
  body: {},
  files: [firstFile],
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

const expectPublicError = (
  next: ReturnType<typeof vi.fn>,
  statusCode: number,
  message: string,
) => {
  expect(next).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode, message }));
};

const expectNoResponse = (recorder: ReturnType<typeof responseRecorder>) => {
  expect(recorder.status).not.toHaveBeenCalled();
  expect(recorder.json).not.toHaveBeenCalled();
};

const expectBefore = (
  first: { mock: { invocationCallOrder: number[] } },
  second: { mock: { invocationCallOrder: number[] } },
  firstIndex = 0,
  secondIndex = 0,
) => {
  expect(first.mock.invocationCallOrder[firstIndex])
    .toBeLessThan(second.mock.invocationCallOrder[secondIndex]);
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.assertChatMember.mockResolvedValue(authorizedChat());
  mocks.uploadFilesToCloudinary.mockResolvedValue([{
    public_id: "attachment-public-id-1",
    secure_url: "https://media.example/first.png",
  }]);
  mocks.messageCreate.mockResolvedValue(newMessage());
  mocks.unreadUpsert.mockResolvedValue({});
});

describe("uploadAttachment guards and authorization cache characterization", () => {
  it("checks missing attachments before chatId and authorization, then cleans the empty input", async () => {
    const req = request({ params: {} as AuthenticatedRequest["params"], files: [] });
    const recorder = responseRecorder();
    const next = vi.fn();

    await uploadAttachment(req, recorder.response, next as NextFunction);

    expectPublicError(next, 400, "Please provide the files");
    expect(mocks.assertChatMember).not.toHaveBeenCalled();
    expect(mocks.uploadFilesToCloudinary).not.toHaveBeenCalled();
    expect(mocks.messageCreate).not.toHaveBeenCalled();
    expect(mocks.emitEventToRoom).not.toHaveBeenCalled();
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([]);
    expectNoResponse(recorder);
  });

  it("checks missing chatId after files exist but before authorization or provider work", async () => {
    const req = request({ params: {} as AuthenticatedRequest["params"] });
    const recorder = responseRecorder();
    const next = vi.fn();

    await uploadAttachment(req, recorder.response, next as NextFunction);

    expectPublicError(next, 400, "ChatId is required");
    expect(mocks.assertChatMember).not.toHaveBeenCalled();
    expect(mocks.uploadFilesToCloudinary).not.toHaveBeenCalled();
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([firstFile]);
    expectNoResponse(recorder);
  });

  it("reuses the route-authorized same-chat cache without a duplicate membership check", async () => {
    const req = request();
    const authorizationNext = vi.fn();

    await authorizeAttachmentUpload(
      req,
      responseRecorder().response,
      authorizationNext as NextFunction,
    );
    await uploadAttachment(req, responseRecorder().response, vi.fn() as NextFunction);

    expect(authorizationNext).toHaveBeenCalledWith();
    expect(mocks.assertChatMember).toHaveBeenCalledOnce();
    expect(mocks.assertChatMember).toHaveBeenCalledWith(ACTOR_ID, CHAT_ID);
    expectBefore(mocks.assertChatMember, mocks.uploadFilesToCloudinary);
  });

  it("falls back to membership authorization with the trusted actor when the cache is missing", async () => {
    const req = request({ body: { userId: "attacker-controlled-user" } });

    await uploadAttachment(req, responseRecorder().response, vi.fn() as NextFunction);

    expect(mocks.assertChatMember).toHaveBeenCalledOnce();
    expect(mocks.assertChatMember).toHaveBeenCalledWith(ACTOR_ID, CHAT_ID);
    expectBefore(mocks.assertChatMember, mocks.uploadFilesToCloudinary);
  });

  it("does not use a cached authorization entry belonging to another chat", async () => {
    const req = request();
    cacheAuthorizedChat(req, authorizedChat({ id: "another-chat" }) as never);

    await uploadAttachment(req, responseRecorder().response, vi.fn() as NextFunction);

    expect(mocks.assertChatMember).toHaveBeenCalledOnce();
    expect(mocks.assertChatMember).toHaveBeenCalledWith(ACTOR_ID, CHAT_ID);
    expectBefore(mocks.assertChatMember, mocks.uploadFilesToCloudinary);
  });

  it("passes an authorization CustomError through and stops before every mutation", async () => {
    const authorizationError = new CustomError("Chat not found", 404);
    mocks.assertChatMember.mockRejectedValue(authorizationError);
    const recorder = responseRecorder();
    const next = vi.fn();

    await uploadAttachment(request(), recorder.response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(authorizationError);
    expect(mocks.uploadFilesToCloudinary).not.toHaveBeenCalled();
    expect(mocks.messageCreate).not.toHaveBeenCalled();
    expect(mocks.unreadUpsert).not.toHaveBeenCalled();
    expect(mocks.emitEventToRoom).not.toHaveBeenCalled();
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([firstFile]);
    expectNoResponse(recorder);
  });
});

describe("uploadAttachment persistence and event characterization", () => {
  it("preserves multi-file mapping, exact message/unread writes, event order, legacy payload, and 201 empty body", async () => {
    const files = [firstFile, secondFile];
    const uploadResults = [
      {
        public_id: "attachment-public-id-1",
        secure_url: "https://media.example/first.png",
        providerOnly: "must-not-be-persisted",
      },
      {
        public_id: "attachment-public-id-2",
        secure_url: "https://media.example/second.pdf",
        providerOnly: "must-not-be-persisted",
      },
    ];
    const persistedMessage = newMessage({
      attachments: [
        { secureUrl: "https://media.example/first.png" },
        { secureUrl: "https://media.example/second.pdf" },
      ],
    });
    mocks.assertChatMember.mockResolvedValue(authorizedChat({
      members: [ACTOR_ID, "member-2", "member-3"],
    }));
    mocks.uploadFilesToCloudinary.mockResolvedValue(uploadResults);
    mocks.messageCreate.mockResolvedValue(persistedMessage);
    const recorder = responseRecorder();
    const next = vi.fn();

    await uploadAttachment(request({
      files,
      body: { senderId: "attacker-controlled-sender" },
    }), recorder.response, next as NextFunction);

    expect(mocks.uploadFilesToCloudinary).toHaveBeenCalledOnce();
    expect(mocks.uploadFilesToCloudinary).toHaveBeenCalledWith({ files });
    expect(mocks.messageCreate).toHaveBeenCalledWith({
      data: {
        chatId: CHAT_ID,
        senderId: ACTOR_ID,
        attachments: {
          createMany: {
            data: [
              {
                cloudinaryPublicId: "attachment-public-id-1",
                secureUrl: "https://media.example/first.png",
              },
              {
                cloudinaryPublicId: "attachment-public-id-2",
                secureUrl: "https://media.example/second.pdf",
              },
            ],
          },
        },
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
      },
      omit: {
        senderId: true,
        pollId: true,
        audioPublicId: true,
      },
    });
    expect(mocks.emitEventToRoom).toHaveBeenNthCalledWith(1, {
      data: persistedMessage,
      event: Events.MESSAGE,
      io,
      room: CHAT_ID,
    });
    expect(mocks.unreadUpsert).toHaveBeenNthCalledWith(1, {
      where: {
        userId_chatId: { userId: "member-2", chatId: CHAT_ID },
      },
      update: {
        count: { increment: 1 },
        senderId: ACTOR_ID,
      },
      create: {
        userId: "member-2",
        chatId: CHAT_ID,
        count: 1,
        senderId: ACTOR_ID,
        messageId: persistedMessage.id,
      },
    });
    expect(mocks.unreadUpsert).toHaveBeenNthCalledWith(2, {
      where: {
        userId_chatId: { userId: "member-3", chatId: CHAT_ID },
      },
      update: {
        count: { increment: 1 },
        senderId: ACTOR_ID,
      },
      create: {
        userId: "member-3",
        chatId: CHAT_ID,
        count: 1,
        senderId: ACTOR_ID,
        messageId: persistedMessage.id,
      },
    });
    expect(mocks.emitEventToRoom).toHaveBeenNthCalledWith(2, {
      data: {
        chatId: CHAT_ID,
        message: {
          attachments: true,
          createdAt,
        },
        sender: {
          id: ACTOR_ID,
          avatar: "https://media.example/actor-avatar.png",
          username: "https://media.example/actor-avatar.png",
        },
      },
      event: Events.UNREAD_MESSAGE,
      io,
      room: CHAT_ID,
    });
    expectBefore(mocks.uploadFilesToCloudinary, mocks.messageCreate);
    expectBefore(mocks.messageCreate, mocks.emitEventToRoom, 0, 0);
    expectBefore(mocks.emitEventToRoom, mocks.unreadUpsert, 0, 0);
    expectBefore(mocks.unreadUpsert, mocks.emitEventToRoom, 0, 1);
    expectBefore(mocks.unreadUpsert, mocks.emitEventToRoom, 1, 1);
    expectBefore(mocks.emitEventToRoom, recorder.status, 1, 0);
    expectBefore(recorder.status, recorder.json);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.deleteFilesFromCloudinary).not.toHaveBeenCalled();
    expect(recorder.status).toHaveBeenCalledWith(201);
    expect(recorder.json).toHaveBeenCalledWith({});
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith(files);
    expect(next).not.toHaveBeenCalled();
  });

  it("emits both room events without unread writes when the actor is the only member", async () => {
    const recorder = responseRecorder();

    await uploadAttachment(request(), recorder.response, vi.fn() as NextFunction);

    expect(mocks.unreadUpsert).not.toHaveBeenCalled();
    expect(mocks.emitEventToRoom).toHaveBeenCalledTimes(2);
    expect(mocks.emitEventToRoom).toHaveBeenNthCalledWith(1, expect.objectContaining({
      event: Events.MESSAGE,
    }));
    expect(mocks.emitEventToRoom).toHaveBeenNthCalledWith(2, expect.objectContaining({
      event: Events.UNREAD_MESSAGE,
    }));
    expect(recorder.status).toHaveBeenCalledWith(201);
    expect(recorder.json).toHaveBeenCalledWith({});
  });
});

describe("uploadAttachment failure cutoffs and cleanup characterization", () => {
  it("maps an upload failure safely, relies on helper-level partial compensation, and always cleans temp files", async () => {
    mocks.uploadFilesToCloudinary.mockRejectedValue(new Error("provider secret and temp path"));
    const recorder = responseRecorder();
    const next = vi.fn();

    await uploadAttachment(request(), recorder.response, next as NextFunction);

    expectPublicError(next, 500, "Failed to upload attachments");
    expect(JSON.stringify(next.mock.calls)).not.toContain("provider secret");
    expect(mocks.deleteFilesFromCloudinary).not.toHaveBeenCalled();
    expect(mocks.messageCreate).not.toHaveBeenCalled();
    expect(mocks.emitEventToRoom).not.toHaveBeenCalled();
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([firstFile]);
    expectNoResponse(recorder);
  });

  it("rolls back every returned ID when the provider returns fewer results than input files", async () => {
    mocks.uploadFilesToCloudinary.mockResolvedValue([{
      public_id: "only-returned-public-id",
      secure_url: "https://media.example/only-result.png",
    }]);
    const recorder = responseRecorder();
    const next = vi.fn();

    await uploadAttachment(
      request({ files: [firstFile, secondFile] }),
      recorder.response,
      next as NextFunction,
    );

    expect(mocks.deleteFilesFromCloudinary).toHaveBeenCalledWith({
      publicIds: ["only-returned-public-id"],
    });
    expectBefore(mocks.uploadFilesToCloudinary, mocks.deleteFilesFromCloudinary);
    expect(mocks.messageCreate).not.toHaveBeenCalled();
    expect(mocks.emitEventToRoom).not.toHaveBeenCalled();
    expectPublicError(next, 500, "Failed to upload attachments");
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([firstFile, secondFile]);
    expectNoResponse(recorder);
  });

  it("keeps the original CustomError when pre-commit rollback rejects and logs only safe metadata", async () => {
    const originalError = new CustomError("Original persistence failure", 409);
    mocks.messageCreate.mockRejectedValue(originalError);
    mocks.deleteFilesFromCloudinary.mockRejectedValue(
      new Error("private provider rollback detail /temporary/path"),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const recorder = responseRecorder();
    const next = vi.fn();

    try {
      await uploadAttachment(request(), recorder.response, next as NextFunction);

      expect(mocks.deleteFilesFromCloudinary).toHaveBeenCalledWith({
        publicIds: ["attachment-public-id-1"],
      });
      expect(next).toHaveBeenCalledWith(originalError);
      expect(consoleError).toHaveBeenCalledWith(
        "New attachment rollback failed.",
        { errorType: "Error" },
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain("private provider rollback detail");
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain("/temporary/path");
      expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([firstFile]);
      expectNoResponse(recorder);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("commits attachments before MESSAGE delivery and retains them when that first event throws", async () => {
    mocks.emitEventToRoom.mockImplementationOnce(() => {
      throw new Error("socket delivery detail");
    });
    const recorder = responseRecorder();
    const next = vi.fn();

    await uploadAttachment(request(), recorder.response, next as NextFunction);

    expect(mocks.messageCreate).toHaveBeenCalledOnce();
    expectBefore(mocks.messageCreate, mocks.emitEventToRoom);
    expect(mocks.emitEventToRoom).toHaveBeenCalledTimes(1);
    expect(mocks.unreadUpsert).not.toHaveBeenCalled();
    expect(mocks.deleteFilesFromCloudinary).not.toHaveBeenCalled();
    expectPublicError(next, 500, "Failed to upload attachments");
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([firstFile]);
    expectNoResponse(recorder);
  });

  it("starts every unread upsert concurrently, permits partial completion, and stops after aggregate rejection", async () => {
    let resolveFirst!: (value: unknown) => void;
    let rejectSecond!: (reason: unknown) => void;
    let resolveThird!: (value: unknown) => void;
    const firstUnread = new Promise((resolve) => { resolveFirst = resolve; });
    const secondUnread = new Promise((_resolve, reject) => { rejectSecond = reject; });
    const thirdUnread = new Promise((resolve) => { resolveThird = resolve; });
    mocks.assertChatMember.mockResolvedValue(authorizedChat({
      members: [ACTOR_ID, "member-2", "member-3", "member-4"],
    }));
    mocks.unreadUpsert
      .mockReturnValueOnce(firstUnread)
      .mockReturnValueOnce(secondUnread)
      .mockReturnValueOnce(thirdUnread);
    const recorder = responseRecorder();
    const next = vi.fn();

    const pendingUpload = uploadAttachment(
      request(),
      recorder.response,
      next as NextFunction,
    );
    await vi.waitFor(() => expect(mocks.unreadUpsert).toHaveBeenCalledTimes(3));

    expect(mocks.emitEventToRoom).toHaveBeenCalledTimes(1);
    expect(mocks.emitEventToRoom).toHaveBeenCalledWith(expect.objectContaining({
      event: Events.MESSAGE,
    }));
    expectBefore(mocks.emitEventToRoom, mocks.unreadUpsert, 0, 0);
    resolveFirst({ id: "persisted-unread-1" });
    rejectSecond(new Error("unread persistence detail"));
    resolveThird({ id: "persisted-unread-3" });
    await pendingUpload;

    expect(mocks.emitEventToRoom).toHaveBeenCalledTimes(1);
    expect(mocks.deleteFilesFromCloudinary).not.toHaveBeenCalled();
    expectPublicError(next, 500, "Failed to upload attachments");
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([firstFile]);
    expectNoResponse(recorder);
  });

  it("retains message, media, and unread writes when UNREAD_MESSAGE delivery throws", async () => {
    mocks.assertChatMember.mockResolvedValue(authorizedChat({
      members: [ACTOR_ID, "member-2"],
    }));
    mocks.emitEventToRoom
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("unread socket detail");
      });
    const recorder = responseRecorder();
    const next = vi.fn();

    await uploadAttachment(request(), recorder.response, next as NextFunction);

    expect(mocks.messageCreate).toHaveBeenCalledOnce();
    expect(mocks.emitEventToRoom).toHaveBeenCalledTimes(2);
    expect(mocks.unreadUpsert).toHaveBeenCalledOnce();
    expectBefore(mocks.emitEventToRoom, mocks.unreadUpsert, 0, 0);
    expectBefore(mocks.unreadUpsert, mocks.emitEventToRoom, 0, 1);
    expect(mocks.deleteFilesFromCloudinary).not.toHaveBeenCalled();
    expectPublicError(next, 500, "Failed to upload attachments");
    expect(mocks.cleanupTemporaryFiles).toHaveBeenCalledWith([firstFile]);
    expectNoResponse(recorder);
  });
});
