import type { Server, Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    user: { update: vi.fn() },
    chatMembers: { findMany: vi.fn() },
    chat: { update: vi.fn() },
    message: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    poll: { create: vi.fn() },
    unreadMessages: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    reactions: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    vote: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    pinnedMessages: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    attachment: { deleteMany: vi.fn() },
  },
}));

vi.mock("../src/services/authorization.service.js", () => ({
  assertChatMember: vi.fn(),
  assertMessageAccessible: vi.fn(),
  assertMessageOwner: vi.fn(),
  assertPinAccessible: vi.fn(),
}));

vi.mock("../src/utils/auth.util.js", () => ({
  deleteFilesFromCloudinary: vi.fn(),
  uploadAudioToCloudinary: vi.fn(),
  uploadEncryptedAudioToCloudinary: vi.fn(),
}));

vi.mock("../src/modules/notifications/push-notification.service.js", () => ({
  sendPushNotification: vi.fn(),
}));

vi.mock("../src/utils/safe-logger.utils.js", () => ({
  logServerError: vi.fn(),
}));

vi.mock("../src/socket/webrtc/socket.js", () => ({ default: vi.fn() }));

import { Events } from "../src/enums/event/event.enum.js";
import { prisma } from "../src/lib/prisma.lib.js";
import {
  assertChatMember,
  assertMessageAccessible,
} from "../src/services/authorization.service.js";
import { SocketConnectionRegistry } from "../src/socket/connection-registry.js";
import type { SocketEventRateLimitPort } from "../src/socket/socket-event-rate-limit.port.js";
import registerSocketHandlers from "../src/socket/socket.js";
import { SOCKET_EVENT_LIMITS } from "../src/socket/socket-security.js";
import {
  deleteFilesFromCloudinary,
  uploadAudioToCloudinary,
  uploadEncryptedAudioToCloudinary,
} from "../src/utils/auth.util.js";
import { sendPushNotification } from "../src/modules/notifications/push-notification.service.js";
import { logServerError } from "../src/utils/safe-logger.utils.js";
import { createCapturingLogger } from "./support/capturing-logger.js";

const ACTOR_ID = "cm41000000000000000000001";
const CHAT_ID = "cm41000000000000000000002";
const REPLY_ID = "cm41000000000000000000003";
const MESSAGE_ID = "cm41000000000000000000004";
const CREATED_AT = new Date("2026-08-01T12:00:00.000Z");

const actor = {
  id: ACTOR_ID,
  username: "socket-actor",
  avatar: "https://media.example/socket-actor.png",
};

const defaultNewMessage = () => ({
  id: MESSAGE_ID,
  isTextMessage: true,
  isPollMessage: false,
  textMessageContent: "hello",
  url: null,
  audioPublicId: null,
  createdAt: CREATED_AT,
});

const populatedMessage = {
  id: MESSAGE_ID,
  isTextMessage: true,
  isPollMessage: false,
  textMessageContent: "hello",
  url: null,
  audioUrl: null,
  createdAt: CREATED_AT,
  sender: actor,
  attachments: [],
  poll: null,
  reactions: [],
  replyToMessage: null,
};

type EventHandler = (payload?: unknown) => Promise<void> | void;

const createLimiter = (
  implementation: (...args: unknown[]) => boolean | Promise<boolean> = () => true,
) => {
  const consumeAll = vi.fn(async (...args: unknown[]) => implementation(...args));
  return {
    consumeAll,
    limiter: {
      consume: vi.fn(async () => true),
      consumeAll,
    } satisfies SocketEventRateLimitPort,
  };
};

const createHarness = async ({
  limiter = createLimiter().limiter,
  roomEmit = vi.fn(),
}: {
  limiter?: SocketEventRateLimitPort;
  roomEmit?: ReturnType<typeof vi.fn>;
} = {}) => {
  const handlers = new Map<string, EventHandler>();
  let connectionHandler: ((socket: Socket) => Promise<void>) | undefined;
  const socket = {
    id: "socket-message-characterization",
    user: actor,
    on: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, handler);
      return socket;
    }),
    emit: vi.fn(),
    join: vi.fn(),
    disconnect: vi.fn(),
    broadcast: {
      emit: vi.fn(),
      to: vi.fn(() => ({ emit: vi.fn() })),
    },
  };
  const io = {
    on: vi.fn((_event: string, handler: (connectedSocket: Socket) => Promise<void>) => {
      connectionHandler = handler;
      return io;
    }),
    to: vi.fn(() => ({ emit: roomEmit })),
  };
  const presence = {
    reconcileTransition: vi.fn(async () => undefined),
    reconcileUser: vi.fn(async () => undefined),
    reconcilePending: vi.fn(async () => 0),
    drain: vi.fn(async () => undefined),
  };
  const logger = createCapturingLogger("socket");

  registerSocketHandlers(io as unknown as Server, {
    registry: new SocketConnectionRegistry(),
    limiter,
    presence,
    logger,
  });
  await connectionHandler!(socket as unknown as Socket);
  vi.mocked(socket.emit).mockClear();

  return {
    io,
    logger,
    roomEmit,
    socket,
    triggerMessage: async (payload: unknown) => {
      const handler = handlers.get(Events.MESSAGE);
      expect(handler).toBeDefined();
      await handler!(payload);
    },
  };
};

const expectBefore = (
  first: { mock: { invocationCallOrder: number[] } },
  second: { mock: { invocationCallOrder: number[] } },
  firstIndex = 0,
  secondIndex = 0,
) => {
  expect(first.mock.invocationCallOrder[firstIndex]).toBeLessThan(
    second.mock.invocationCallOrder[secondIndex],
  );
};

const expectedMessageProjection = {
  where: { chatId: CHAT_ID, id: MESSAGE_ID },
  include: {
    sender: {
      select: { id: true, username: true, avatar: true },
    },
    attachments: {
      select: { secureUrl: true },
    },
    poll: {
      omit: { id: true },
      include: {
        votes: {
          include: {
            user: {
              select: { id: true, username: true, avatar: true },
            },
          },
          omit: { id: true, pollId: true, userId: true },
        },
      },
    },
    reactions: {
      select: {
        user: {
          select: { id: true, username: true, avatar: true },
        },
        reaction: true,
      },
    },
    replyToMessage: {
      select: {
        sender: {
          select: { id: true, username: true, avatar: true },
        },
        id: true,
        textMessageContent: true,
        isPollMessage: true,
        url: true,
        audioUrl: true,
        attachments: {
          select: { secureUrl: true },
        },
      },
    },
  },
  omit: { senderId: true, pollId: true, audioPublicId: true },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.user.update).mockResolvedValue({} as never);
  vi.mocked(prisma.chatMembers.findMany).mockResolvedValue([]);
  vi.mocked(assertChatMember).mockResolvedValue({ id: CHAT_ID } as never);
  vi.mocked(assertMessageAccessible).mockResolvedValue({ id: REPLY_ID } as never);
  vi.mocked(prisma.message.create).mockResolvedValue(defaultNewMessage() as never);
  vi.mocked(prisma.chat.update).mockResolvedValue({ ChatMembers: [] } as never);
  vi.mocked(prisma.message.findUnique).mockResolvedValue(populatedMessage as never);
  vi.mocked(prisma.poll.create).mockResolvedValue({ id: "poll-created" } as never);
  vi.mocked(prisma.unreadMessages.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.unreadMessages.update).mockResolvedValue({ id: "unread-updated" } as never);
  vi.mocked(prisma.unreadMessages.create).mockResolvedValue({ id: "unread-created" } as never);
  vi.mocked(deleteFilesFromCloudinary).mockResolvedValue(undefined);
});

describe("Socket MESSAGE pre-extraction security and rate-limit characterization", () => {
  it("parses strictly before rate limiting and rejects a client-supplied sender identity", async () => {
    const { consumeAll, limiter } = createLimiter();
    const harness = await createHarness({ limiter });

    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      textMessageContent: "hello",
      senderId: "cm41000000000000000000999",
    });

    expect(harness.socket.emit).toHaveBeenCalledWith(Events.SECURITY_ERROR, {
      category: "INVALID_PAYLOAD",
      event: Events.MESSAGE,
    });
    expect(consumeAll).not.toHaveBeenCalled();
    expect(assertChatMember).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("applies actor limit, membership, reply access, then both chat limits before creation", async () => {
    const order: string[] = [];
    const { consumeAll, limiter } = createLimiter((policies) => {
      order.push((policies as unknown[]).length === 1 ? "actor-limit" : "chat-limits");
      return true;
    });
    vi.mocked(assertChatMember).mockImplementation(async () => {
      order.push("chat-member");
      return { id: CHAT_ID } as never;
    });
    vi.mocked(assertMessageAccessible).mockImplementation(async () => {
      order.push("reply-access");
      return { id: REPLY_ID } as never;
    });
    vi.mocked(prisma.message.create).mockImplementation(async () => {
      order.push("message-create");
      return defaultNewMessage() as never;
    });
    const harness = await createHarness({ limiter });

    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      textMessageContent: "hello",
      replyToMessageId: REPLY_ID,
    });

    expect(order.slice(0, 5)).toEqual([
      "actor-limit",
      "chat-member",
      "reply-access",
      "chat-limits",
      "message-create",
    ]);
    expect(consumeAll).toHaveBeenNthCalledWith(1, [SOCKET_EVENT_LIMITS.messageActorBurst], [ACTOR_ID]);
    expect(consumeAll).toHaveBeenNthCalledWith(
      2,
      [SOCKET_EVENT_LIMITS.messageChatBurst, SOCKET_EVENT_LIMITS.messageChatWindow],
      [ACTOR_ID, CHAT_ID],
    );
    expect(assertChatMember).toHaveBeenCalledWith(ACTOR_ID, CHAT_ID);
    expect(assertMessageAccessible).toHaveBeenCalledWith(ACTOR_ID, CHAT_ID, REPLY_ID);
  });

  it("stops an actor-limited request before authorization", async () => {
    const { consumeAll, limiter } = createLimiter(() => false);
    const harness = await createHarness({ limiter });

    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      textMessageContent: "hello",
    });

    expect(consumeAll).toHaveBeenCalledOnce();
    expect(assertChatMember).not.toHaveBeenCalled();
    expect(harness.socket.emit).toHaveBeenCalledWith(Events.SECURITY_ERROR, {
      category: "RATE_LIMITED",
      event: Events.MESSAGE,
    });
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("awaits actor admission before authorization and persistence", async () => {
    let resolveAdmission: ((allowed: boolean) => void) | undefined;
    const admission = new Promise<boolean>((resolve) => {
      resolveAdmission = resolve;
    });
    const { consumeAll, limiter } = createLimiter(() => admission);
    const harness = await createHarness({ limiter });

    const handling = harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      textMessageContent: "hello",
    });

    expect(consumeAll).toHaveBeenCalledOnce();
    expect(assertChatMember).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();

    resolveAdmission!(true);
    await handling;

    expect(assertChatMember).toHaveBeenCalledWith(ACTOR_ID, CHAT_ID);
    expect(consumeAll).toHaveBeenCalledTimes(2);
    expect(prisma.message.create).toHaveBeenCalledOnce();
  });

  it("fails closed before authorization when the limiter provider rejects", async () => {
    const providerFailure = new Error("private Redis provider detail");
    const { consumeAll, limiter } = createLimiter(async () => {
      throw providerFailure;
    });
    const harness = await createHarness({ limiter });

    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      textMessageContent: "hello",
    });

    expect(consumeAll).toHaveBeenCalledOnce();
    expect(logServerError).not.toHaveBeenCalled();
    expect(harness.logger.events).toContainEqual({
      level: "error",
      component: "socket",
      event: "socket.rate_limit.unavailable",
      fields: {
        operation: "message_send",
        result: "unavailable",
        errorType: "Error",
      },
    });
    expect(JSON.stringify(harness.logger.events)).not.toContain(providerFailure.message);
    expect(harness.socket.emit).toHaveBeenCalledWith(Events.SECURITY_ERROR, {
      category: "RATE_LIMITED",
      event: Events.MESSAGE,
    });
    expect(assertChatMember).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(harness.roomEmit).not.toHaveBeenCalled();
  });

  it("does not consume chat limits when reply authorization fails and safe-logs only", async () => {
    const replyError = new Error("private reply lookup detail");
    vi.mocked(assertMessageAccessible).mockRejectedValue(replyError);
    const { consumeAll, limiter } = createLimiter();
    const harness = await createHarness({ limiter });

    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      textMessageContent: "hello",
      replyToMessageId: REPLY_ID,
    });

    expect(consumeAll).toHaveBeenCalledOnce();
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(harness.logger.events.at(-1)).toMatchObject({
      event: "socket.message_send.failed",
      fields: {
        operation: "message_send",
        result: "failed",
        errorType: "Error",
      },
    });
    expect(harness.socket.emit).not.toHaveBeenCalled();
    expect(harness.roomEmit).not.toHaveBeenCalled();
  });
});

describe("Socket MESSAGE variant persistence characterization", () => {
  it("preserves audio, encrypted-audio, poll, URL, and text creation data and branch order", async () => {
    const plainAudio = new Uint8Array([1, 2, 3]);
    const encryptedAudio = new Uint8Array([4, 5, 6]);
    vi.mocked(uploadAudioToCloudinary).mockResolvedValue({
      public_id: "plain-audio-id",
      secure_url: "https://media.example/plain-audio.webm",
    } as never);
    vi.mocked(uploadEncryptedAudioToCloudinary).mockResolvedValue({
      public_id: "encrypted-audio-id",
      secure_url: "https://media.example/encrypted-audio.webm",
    } as never);
    vi.mocked(prisma.message.create)
      .mockResolvedValueOnce({
        id: "plain-message",
        isTextMessage: false,
        isPollMessage: false,
        audioPublicId: "plain-audio-id",
        createdAt: CREATED_AT,
      } as never)
      .mockResolvedValueOnce({
        id: "encrypted-message",
        isTextMessage: false,
        isPollMessage: false,
        audioPublicId: "encrypted-audio-id",
        createdAt: CREATED_AT,
      } as never)
      .mockResolvedValueOnce({
        id: "poll-message",
        isTextMessage: false,
        isPollMessage: true,
        createdAt: CREATED_AT,
      } as never)
      .mockResolvedValueOnce({
        id: "url-message",
        isTextMessage: false,
        isPollMessage: false,
        url: "https://example.test/article",
        createdAt: CREATED_AT,
      } as never)
      .mockResolvedValueOnce(defaultNewMessage() as never);
    const harness = await createHarness();

    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      pollData: { pollOptions: [] },
      audio: plainAudio,
      audioMimeType: "audio/webm",
      replyToMessageId: REPLY_ID,
    });
    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      encryptedAudio,
      audioMimeType: "audio/webm",
      replyToMessageId: REPLY_ID,
    });
    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: true,
      pollData: {
        pollQuestion: "Which option?",
        pollOptions: ["one", "two"],
        isMultipleAnswers: false,
      },
      replyToMessageId: REPLY_ID,
    });
    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      url: "https://example.test/article",
      replyToMessageId: REPLY_ID,
    });
    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      textMessageContent: "hello",
      replyToMessageId: REPLY_ID,
    });

    expect(uploadAudioToCloudinary).toHaveBeenCalledWith({ buffer: plainAudio });
    expect(uploadEncryptedAudioToCloudinary).toHaveBeenCalledWith({ buffer: encryptedAudio });
    expect(prisma.poll.create).toHaveBeenCalledOnce();
    expect(prisma.poll.create).toHaveBeenCalledWith({
      data: {
        question: "Which option?",
        options: ["one", "two"],
        multipleAnswers: false,
      },
    });
    expect(prisma.message.create).toHaveBeenNthCalledWith(1, {
      data: {
        senderId: ACTOR_ID,
        chatId: CHAT_ID,
        isTextMessage: false,
        isPollMessage: false,
        audioPublicId: "plain-audio-id",
        audioUrl: "https://media.example/plain-audio.webm",
        replyToMessageId: REPLY_ID,
      },
    });
    expect(prisma.message.create).toHaveBeenNthCalledWith(2, {
      data: {
        senderId: ACTOR_ID,
        chatId: CHAT_ID,
        isTextMessage: false,
        isPollMessage: false,
        audioPublicId: "encrypted-audio-id",
        audioUrl: "https://media.example/encrypted-audio.webm",
        replyToMessageId: REPLY_ID,
      },
    });
    expect(prisma.message.create).toHaveBeenNthCalledWith(3, {
      data: {
        senderId: ACTOR_ID,
        chatId: CHAT_ID,
        pollId: "poll-created",
        isPollMessage: true,
        isTextMessage: false,
        replyToMessageId: REPLY_ID,
      },
    });
    expect(prisma.message.create).toHaveBeenNthCalledWith(4, {
      data: {
        senderId: ACTOR_ID,
        chatId: CHAT_ID,
        url: "https://example.test/article",
        isPollMessage: false,
        isTextMessage: false,
        replyToMessageId: REPLY_ID,
      },
    });
    expect(prisma.message.create).toHaveBeenNthCalledWith(5, {
      data: {
        senderId: ACTOR_ID,
        chatId: CHAT_ID,
        isPollMessage: false,
        isTextMessage: true,
        textMessageContent: "hello",
        replyToMessageId: REPLY_ID,
      },
    });
    expectBefore(uploadAudioToCloudinary, prisma.message.create, 0, 0);
    expectBefore(uploadEncryptedAudioToCloudinary, prisma.message.create, 0, 1);
    expectBefore(prisma.poll.create, prisma.message.create, 0, 2);
    expect(harness.roomEmit).toHaveBeenNthCalledWith(2, Events.UNREAD_MESSAGE, {
      chatId: CHAT_ID,
      message: {
        textMessageContent: undefined,
        url: false,
        attachments: false,
        poll: false,
        audio: true,
        createdAt: CREATED_AT,
      },
      sender: actor,
    });
    expect(harness.roomEmit).toHaveBeenNthCalledWith(4, Events.UNREAD_MESSAGE, {
      chatId: CHAT_ID,
      message: {
        textMessageContent: undefined,
        url: false,
        attachments: false,
        poll: false,
        audio: true,
        createdAt: CREATED_AT,
      },
      sender: actor,
    });
    expect(harness.roomEmit).toHaveBeenNthCalledWith(6, Events.UNREAD_MESSAGE, {
      chatId: CHAT_ID,
      message: {
        textMessageContent: undefined,
        url: false,
        attachments: false,
        poll: true,
        audio: false,
        createdAt: CREATED_AT,
      },
      sender: actor,
    });
    expect(harness.roomEmit).toHaveBeenNthCalledWith(8, Events.UNREAD_MESSAGE, {
      chatId: CHAT_ID,
      message: {
        textMessageContent: undefined,
        url: true,
        attachments: false,
        poll: false,
        audio: false,
        createdAt: CREATED_AT,
      },
      sender: actor,
    });
    expect(harness.roomEmit).toHaveBeenNthCalledWith(10, Events.UNREAD_MESSAGE, {
      chatId: CHAT_ID,
      message: {
        textMessageContent: "hello",
        url: false,
        attachments: false,
        poll: false,
        audio: false,
        createdAt: CREATED_AT,
      },
      sender: actor,
    });
  });

  it.each([
    ["plain", "audio", uploadAudioToCloudinary, "Audio upload failed."],
    ["encrypted", "encryptedAudio", uploadEncryptedAudioToCloudinary, "Encrypted audio upload failed."],
  ] as const)("returns without persistence when %s audio upload has no result", async (
    _label,
    field,
    upload,
    expectedError,
  ) => {
    vi.mocked(upload).mockResolvedValue(undefined);
    const harness = await createHarness();

    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      [field]: new Uint8Array([1, 2, 3]),
      audioMimeType: "audio/webm",
    });

    expect(harness.logger.events.at(-1)).toMatchObject({ event: expectedError.includes("Encrypted")
      ? "socket.encrypted_audio_upload.failed"
      : "socket.audio_upload.failed" });
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.chat.update).not.toHaveBeenCalled();
    expect(harness.roomEmit).not.toHaveBeenCalled();
  });

  it.each([
    ["plain", "audio", uploadAudioToCloudinary, "plain-orphan"],
    ["encrypted", "encryptedAudio", uploadEncryptedAudioToCloudinary, "encrypted-orphan"],
  ] as const)("rolls back a newly uploaded %s raw asset when message creation fails", async (
    _label,
    field,
    upload,
    publicId,
  ) => {
    const persistenceError = new Error("private database detail");
    vi.mocked(upload).mockResolvedValue({
      public_id: publicId,
      secure_url: `https://media.example/${publicId}`,
    } as never);
    vi.mocked(prisma.message.create).mockRejectedValue(persistenceError);
    const harness = await createHarness();

    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      [field]: new Uint8Array([1, 2, 3]),
      audioMimeType: "audio/webm",
    });

    expect(deleteFilesFromCloudinary).toHaveBeenCalledWith({
      publicIds: [publicId],
      resourceType: "raw",
    });
    expect(harness.logger.events.at(-1)).toMatchObject({
      event: "socket.message_send.failed",
      fields: { errorType: "Error" },
    });
    expect(prisma.chat.update).not.toHaveBeenCalled();
    expect(harness.roomEmit).not.toHaveBeenCalled();
  });

  it("lets rollback rejection replace the original audio persistence error at the outer boundary", async () => {
    const persistenceError = new Error("original persistence failure");
    const rollbackError = new Error("raw deletion failure");
    vi.mocked(uploadAudioToCloudinary).mockResolvedValue({
      public_id: "plain-orphan",
      secure_url: "https://media.example/plain-orphan",
    } as never);
    vi.mocked(prisma.message.create).mockRejectedValue(persistenceError);
    vi.mocked(deleteFilesFromCloudinary).mockRejectedValue(rollbackError);
    const harness = await createHarness();

    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      audio: new Uint8Array([1, 2, 3]),
      audioMimeType: "audio/webm",
    });

    expect(harness.logger.events).toHaveLength(1);
    expect(harness.logger.events[0]).toMatchObject({
      event: "socket.message_send.failed",
      fields: { errorType: "Error" },
    });
    expect(harness.socket.emit).not.toHaveBeenCalled();
  });

  it("leaves a created poll orphaned when the subsequent message creation fails", async () => {
    const persistenceError = new Error("message creation failure");
    vi.mocked(prisma.poll.create).mockResolvedValue({ id: "orphan-poll" } as never);
    vi.mocked(prisma.message.create).mockRejectedValue(persistenceError);
    const harness = await createHarness();

    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: true,
      pollData: {
        pollQuestion: "Keep the orphan?",
        pollOptions: ["yes", "no"],
      },
    });

    expect(prisma.poll.create).toHaveBeenCalledWith({
      data: {
        question: "Keep the orphan?",
        options: ["yes", "no"],
        multipleAnswers: false,
      },
    });
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: {
        senderId: ACTOR_ID,
        chatId: CHAT_ID,
        pollId: "orphan-poll",
        isPollMessage: true,
        isTextMessage: false,
        replyToMessageId: undefined,
      },
    });
    expect(prisma.chat.update).not.toHaveBeenCalled();
    expect(deleteFilesFromCloudinary).not.toHaveBeenCalled();
    expect(harness.logger.events.at(-1)).toMatchObject({ event: "socket.message_send.failed" });
    expect(harness.roomEmit).not.toHaveBeenCalled();
  });
});

describe("Socket MESSAGE projection, notification, and unread characterization", () => {
  it("preserves latest-message update, populated projection, recipient writes, and exact event order", async () => {
    const existingMember = {
      user: {
        id: "offline-existing",
        isOnline: false,
        notificationsEnabled: true,
        fcmToken: "private-offline-token",
      },
    };
    const onlineMember = {
      user: {
        id: "online-new",
        isOnline: true,
        notificationsEnabled: true,
        fcmToken: "private-online-token",
      },
    };
    const disabledMember = {
      user: {
        id: "offline-disabled",
        isOnline: false,
        notificationsEnabled: false,
        fcmToken: "private-disabled-token",
      },
    };
    const senderMember = {
      user: {
        id: ACTOR_ID,
        isOnline: false,
        notificationsEnabled: true,
        fcmToken: "private-sender-token",
      },
    };
    vi.mocked(prisma.chat.update).mockResolvedValue({
      ChatMembers: [senderMember, existingMember, onlineMember, disabledMember],
    } as never);
    vi.mocked(prisma.unreadMessages.findUnique).mockImplementation(async ({ where }: never) => {
      const userId = (where as { userId_chatId: { userId: string } }).userId_chatId.userId;
      return userId === existingMember.user.id ? { id: "existing-unread" } as never : null;
    });
    // A promise return is intentionally ignored by the current void notification seam.
    vi.mocked(sendPushNotification).mockReturnValue(new Promise(() => undefined) as never);
    const harness = await createHarness();

    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      textMessageContent: "hello",
    });

    expect(prisma.chat.update).toHaveBeenCalledWith({
      where: { id: CHAT_ID },
      data: { latestMessageId: MESSAGE_ID },
      include: {
        ChatMembers: {
          select: {
            user: {
              select: {
                id: true,
                isOnline: true,
                notificationsEnabled: true,
                fcmToken: true,
              },
            },
          },
        },
      },
    });
    expect(prisma.message.findUnique).toHaveBeenCalledWith(expectedMessageProjection);
    expectBefore(prisma.message.create, prisma.chat.update);
    expectBefore(prisma.chat.update, prisma.message.findUnique);

    expect(harness.io.to).toHaveBeenNthCalledWith(1, CHAT_ID);
    expect(harness.roomEmit).toHaveBeenNthCalledWith(1, Events.MESSAGE, {
      ...populatedMessage,
      isNew: true,
    });
    expect(sendPushNotification).toHaveBeenCalledOnce();
    expect(sendPushNotification).toHaveBeenCalledWith({
      recipientToken: "private-offline-token",
      body: "New message from socket-actor",
    });
    expectBefore(harness.roomEmit, sendPushNotification, 0, 0);
    expectBefore(sendPushNotification, prisma.unreadMessages.findUnique, 0, 0);

    expect(prisma.unreadMessages.findUnique).toHaveBeenCalledTimes(3);
    expect(prisma.unreadMessages.findUnique).toHaveBeenNthCalledWith(1, {
      where: { userId_chatId: { userId: "offline-existing", chatId: CHAT_ID } },
    });
    expect(prisma.unreadMessages.findUnique).toHaveBeenNthCalledWith(2, {
      where: { userId_chatId: { userId: "online-new", chatId: CHAT_ID } },
    });
    expect(prisma.unreadMessages.findUnique).toHaveBeenNthCalledWith(3, {
      where: { userId_chatId: { userId: "offline-disabled", chatId: CHAT_ID } },
    });
    expect(prisma.unreadMessages.update).toHaveBeenCalledOnce();
    expect(prisma.unreadMessages.update).toHaveBeenCalledWith({
      where: { userId_chatId: { userId: "offline-existing", chatId: CHAT_ID } },
      data: {
        count: { increment: 1 },
        messageId: MESSAGE_ID,
      },
    });
    expect(prisma.unreadMessages.create).toHaveBeenCalledTimes(2);
    expect(prisma.unreadMessages.create).toHaveBeenNthCalledWith(1, {
      data: {
        userId: "online-new",
        chatId: CHAT_ID,
        count: 1,
        senderId: ACTOR_ID,
        messageId: MESSAGE_ID,
      },
    });
    expect(prisma.unreadMessages.create).toHaveBeenNthCalledWith(2, {
      data: {
        userId: "offline-disabled",
        chatId: CHAT_ID,
        count: 1,
        senderId: ACTOR_ID,
        messageId: MESSAGE_ID,
      },
    });
    expect(harness.io.to).toHaveBeenNthCalledWith(2, CHAT_ID);
    expect(harness.roomEmit).toHaveBeenNthCalledWith(2, Events.UNREAD_MESSAGE, {
      chatId: CHAT_ID,
      message: {
        textMessageContent: "hello",
        url: false,
        attachments: false,
        poll: false,
        audio: false,
        createdAt: CREATED_AT,
      },
      sender: actor,
    });
    expectBefore(prisma.unreadMessages.update, harness.roomEmit, 0, 1);
    expectBefore(prisma.unreadMessages.create, harness.roomEmit, 0, 1);
    expectBefore(prisma.unreadMessages.create, harness.roomEmit, 1, 1);
    const emittedPayloads = JSON.stringify(harness.roomEmit.mock.calls);
    expect(emittedPayloads).not.toContain("private-offline-token");
    expect(emittedPayloads).not.toContain("private-online-token");
    expect(emittedPayloads).not.toContain("private-disabled-token");
    expect(emittedPayloads).not.toContain("private-sender-token");
  });

  it("starts every unread lookup concurrently, permits partial writes, and suppresses UNREAD_MESSAGE on failure", async () => {
    let resolveFirst!: (value: unknown) => void;
    let rejectSecond!: (reason: unknown) => void;
    let resolveThird!: (value: unknown) => void;
    const firstLookup = new Promise(resolve => { resolveFirst = resolve; });
    const secondLookup = new Promise((_resolve, reject) => { rejectSecond = reject; });
    const thirdLookup = new Promise(resolve => { resolveThird = resolve; });
    const members = ["member-one", "member-two", "member-three"].map(id => ({
      user: { id, isOnline: true, notificationsEnabled: true, fcmToken: `${id}-token` },
    }));
    vi.mocked(prisma.chat.update).mockResolvedValue({ ChatMembers: members } as never);
    vi.mocked(prisma.unreadMessages.findUnique)
      .mockReturnValueOnce(firstLookup as never)
      .mockReturnValueOnce(secondLookup as never)
      .mockReturnValueOnce(thirdLookup as never);
    const unreadError = new Error("private unread lookup failure");
    const harness = await createHarness();

    const pending = harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      textMessageContent: "hello",
    });
    await vi.waitFor(() => expect(prisma.unreadMessages.findUnique).toHaveBeenCalledTimes(3));

    expect(harness.roomEmit).toHaveBeenCalledOnce();
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.MESSAGE, {
      ...populatedMessage,
      isNew: true,
    });
    resolveFirst({ id: "existing-unread" });
    resolveThird(null);
    await vi.waitFor(() => {
      expect(prisma.unreadMessages.update).toHaveBeenCalledOnce();
      expect(prisma.unreadMessages.create).toHaveBeenCalledOnce();
    });
    rejectSecond(unreadError);
    await pending;

    expect(prisma.unreadMessages.update).toHaveBeenCalledWith({
      where: { userId_chatId: { userId: "member-one", chatId: CHAT_ID } },
      data: { count: { increment: 1 }, messageId: MESSAGE_ID },
    });
    expect(prisma.unreadMessages.create).toHaveBeenCalledWith({
      data: {
        userId: "member-three",
        chatId: CHAT_ID,
        count: 1,
        senderId: ACTOR_ID,
        messageId: MESSAGE_ID,
      },
    });
    expect(harness.roomEmit).toHaveBeenCalledTimes(1);
    expect(harness.logger.events.at(-1)).toMatchObject({ event: "socket.message_send.failed" });
    expect(deleteFilesFromCloudinary).not.toHaveBeenCalled();
  });
});

describe("Socket MESSAGE committed-state failure cutoffs", () => {
  it("keeps the created message and latest pointer when populated read returns null, then returns silently", async () => {
    vi.mocked(prisma.message.findUnique).mockResolvedValue(null);
    const harness = await createHarness();

    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      textMessageContent: "hello",
    });

    expect(prisma.message.create).toHaveBeenCalledOnce();
    expect(prisma.chat.update).toHaveBeenCalledOnce();
    expect(harness.logger.events.at(-1)).toMatchObject({
      event: "socket.message_retrieval.failed",
      fields: { result: "failed" },
    });
    expect(harness.roomEmit).not.toHaveBeenCalled();
    expect(prisma.unreadMessages.findUnique).not.toHaveBeenCalled();
  });

  it("stops after latest-message update failure and uses the event-local safe log", async () => {
    const updateError = new Error("private latest-message update failure");
    vi.mocked(prisma.chat.update).mockRejectedValue(updateError);
    const harness = await createHarness();

    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      textMessageContent: "hello",
    });

    expect(prisma.message.create).toHaveBeenCalledOnce();
    expect(prisma.message.findUnique).not.toHaveBeenCalled();
    expect(harness.roomEmit).not.toHaveBeenCalled();
    expect(harness.logger.events.at(-1)).toMatchObject({ event: "socket.message_send.failed" });
    expect(harness.socket.emit).not.toHaveBeenCalled();
  });

  it("does no unread work when MESSAGE delivery throws after persistence and projection", async () => {
    const deliveryError = new Error("private room delivery failure");
    const roomEmit = vi.fn(() => {
      throw deliveryError;
    });
    vi.mocked(prisma.chat.update).mockResolvedValue({
      ChatMembers: [{
        user: {
          id: "recipient",
          isOnline: false,
          notificationsEnabled: true,
          fcmToken: "private-token",
        },
      }],
    } as never);
    const harness = await createHarness({ roomEmit });

    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      textMessageContent: "hello",
    });

    expect(prisma.message.create).toHaveBeenCalledOnce();
    expect(prisma.chat.update).toHaveBeenCalledOnce();
    expect(prisma.message.findUnique).toHaveBeenCalledOnce();
    expect(roomEmit).toHaveBeenCalledWith(Events.MESSAGE, { ...populatedMessage, isNew: true });
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(prisma.unreadMessages.findUnique).not.toHaveBeenCalled();
    expect(harness.logger.events.at(-1)).toMatchObject({ event: "socket.message_send.failed" });
  });

  it("retains message and unread writes when UNREAD_MESSAGE delivery throws", async () => {
    const deliveryError = new Error("private unread delivery failure");
    const roomEmit = vi.fn((event: Events) => {
      if (event === Events.UNREAD_MESSAGE) throw deliveryError;
    });
    vi.mocked(prisma.chat.update).mockResolvedValue({
      ChatMembers: [{
        user: {
          id: "recipient",
          isOnline: true,
          notificationsEnabled: true,
          fcmToken: "private-token",
        },
      }],
    } as never);
    const harness = await createHarness({ roomEmit });

    await harness.triggerMessage({
      chatId: CHAT_ID,
      isPollMessage: false,
      textMessageContent: "hello",
    });

    expect(prisma.message.create).toHaveBeenCalledOnce();
    expect(prisma.unreadMessages.create).toHaveBeenCalledOnce();
    expect(roomEmit).toHaveBeenNthCalledWith(1, Events.MESSAGE, { ...populatedMessage, isNew: true });
    expect(roomEmit).toHaveBeenNthCalledWith(2, Events.UNREAD_MESSAGE, expect.any(Object));
    expect(harness.logger.events.at(-1)).toMatchObject({ event: "socket.message_send.failed" });
    expect(deleteFilesFromCloudinary).not.toHaveBeenCalled();
    expect(harness.socket.emit).not.toHaveBeenCalled();
  });
});
