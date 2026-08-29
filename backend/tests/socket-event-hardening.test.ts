import type { Server, Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    user: { update: vi.fn() },
    chatMembers: { findMany: vi.fn() },
    chat: { findFirst: vi.fn(), update: vi.fn() },
    message: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
    poll: { create: vi.fn() },
    unreadMessages: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    reactions: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    vote: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    pinnedMessages: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    attachment: { deleteMany: vi.fn() },
  },
}));

vi.mock("../src/utils/auth.util.js", () => ({
  deleteFilesFromCloudinary: vi.fn(),
  uploadAudioToCloudinary: vi.fn(),
  uploadEncryptedAudioToCloudinary: vi.fn(),
}));
vi.mock("../src/modules/notifications/push-notification.service.js", () => ({ sendPushNotification: vi.fn() }));
vi.mock("../src/socket/webrtc/socket.js", () => ({ default: vi.fn() }));

import { Events } from "../src/enums/event/event.enum.js";
import { ApplicationError } from "../src/errors/application-error.js";
import { prisma } from "../src/lib/prisma.lib.js";
import { MAX_SOCKET_AUDIO_BYTES, MAX_SOCKET_TEXT_LENGTH } from "../src/schemas/socket.schema.js";
import { SocketConnectionRegistry } from "../src/socket/connection-registry.js";
import registerSocketHandlers from "../src/socket/socket.js";
import { SocketEventRateLimiter } from "../src/socket/socket-security.js";
import { uploadAudioToCloudinary, uploadEncryptedAudioToCloudinary } from "../src/utils/auth.util.js";

const USER_ID = "cm30000000000000000000001";
const CHAT_ID = "cm30000000000000000000002";
const OTHER_CHAT_ID = "cm30000000000000000000003";
const MESSAGE_ID = "cm30000000000000000000004";
const PIN_ID = "cm30000000000000000000005";
const POLL_ID = "cm30000000000000000000006";

type EventHandler = (payload?: unknown) => Promise<void> | void;

const memberChat = (chatId = CHAT_ID) => ({
  id: chatId,
  ChatMembers: [{ userId: USER_ID }],
});

const accessibleMessage = ({ pollId = null }: { pollId?: string | null } = {}) => ({
  id: MESSAGE_ID,
  chatId: CHAT_ID,
  senderId: USER_ID,
  pollId,
  attachments: [],
  audioPublicId: null,
});

const createHarness = async () => {
  const handlers = new Map<string, EventHandler>();
  let connectionHandler: ((socket: Socket) => Promise<void>) | undefined;
  const roomEmit = vi.fn();
  const broadcastRoomEmit = vi.fn();
  const socket = {
    id: "socket-event-test",
    user: { id: USER_ID, username: "actor", avatar: "avatar" },
    rooms: new Set([CHAT_ID, OTHER_CHAT_ID]),
    on: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, handler);
      return socket;
    }),
    emit: vi.fn(),
    join: vi.fn(),
    disconnect: vi.fn(),
    broadcast: {
      emit: vi.fn(),
      to: vi.fn(() => ({ emit: broadcastRoomEmit })),
    },
  };
  const io = {
    on: vi.fn((_event: string, handler: (socket: Socket) => Promise<void>) => {
      connectionHandler = handler;
      return io;
    }),
    to: vi.fn(() => ({ emit: roomEmit })),
  };

  registerSocketHandlers(io as unknown as Server, {
    registry: new SocketConnectionRegistry(),
    limiter: new SocketEventRateLimiter(),
  });
  await connectionHandler!(socket as unknown as Socket);
  vi.mocked(socket.emit).mockClear();

  return {
    broadcastRoomEmit,
    roomEmit,
    socket,
    trigger: async (event: Events, payload: unknown) => {
      const handler = handlers.get(event);
      expect(handler).toBeDefined();
      await handler!(payload);
    },
  };
};

const expectSecurityError = (
  socket: { emit: ReturnType<typeof vi.fn> },
  category: "INVALID_PAYLOAD" | "RATE_LIMITED",
  event: Events,
) => expect(socket.emit).toHaveBeenCalledWith(Events.SECURITY_ERROR, { category, event });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.update).mockResolvedValue({} as never);
  vi.mocked(prisma.chatMembers.findMany).mockResolvedValue([]);
  vi.mocked(prisma.chat.findFirst).mockResolvedValue(memberChat() as never);
  vi.mocked(prisma.chat.update).mockResolvedValue({ ChatMembers: [] } as never);
  vi.mocked(prisma.message.findFirst).mockResolvedValue(accessibleMessage() as never);
  vi.mocked(prisma.message.create).mockResolvedValue({
    id: MESSAGE_ID,
    isTextMessage: true,
    isPollMessage: false,
    textMessageContent: "hello",
    createdAt: new Date(),
  } as never);
  vi.mocked(prisma.message.findUnique).mockResolvedValue({ id: MESSAGE_ID } as never);
  vi.mocked(prisma.message.update).mockResolvedValue({ textMessageContent: "updated" } as never);
  vi.mocked(prisma.unreadMessages.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.unreadMessages.update).mockResolvedValue({ readAt: new Date() } as never);
  vi.mocked(prisma.reactions.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.pinnedMessages.findMany).mockResolvedValue([]);
  vi.mocked(prisma.pinnedMessages.create).mockResolvedValue({ id: PIN_ID } as never);
});

describe("Socket chat payload validation", () => {
  it("rejects a malformed MESSAGE before DB and provider work", async () => {
    const harness = await createHarness();
    vi.clearAllMocks();

    await harness.trigger(Events.MESSAGE, { chatId: CHAT_ID });

    expectSecurityError(harness.socket, "INVALID_PAYLOAD", Events.MESSAGE);
    expect(prisma.chat.findFirst).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(uploadAudioToCloudinary).not.toHaveBeenCalled();
  });

  it("rejects oversized text before authorization or persistence", async () => {
    const harness = await createHarness();
    vi.clearAllMocks();

    await harness.trigger(Events.MESSAGE, {
      chatId: CHAT_ID,
      isPollMessage: false,
      textMessageContent: "x".repeat(MAX_SOCKET_TEXT_LENGTH + 1),
    });

    expectSecurityError(harness.socket, "INVALID_PAYLOAD", Events.MESSAGE);
    expect(prisma.chat.findFirst).not.toHaveBeenCalled();
  });

  it("rejects malformed and oversized Socket audio before Cloudinary", async () => {
    const harness = await createHarness();
    vi.clearAllMocks();

    await harness.trigger(Events.MESSAGE, {
      chatId: CHAT_ID,
      isPollMessage: false,
      audio: "not-binary",
    });
    await harness.trigger(Events.MESSAGE, {
      chatId: CHAT_ID,
      isPollMessage: false,
      encryptedAudio: new Uint8Array(MAX_SOCKET_AUDIO_BYTES + 1),
      audioMimeType: "audio/webm",
    });
    await harness.trigger(Events.MESSAGE, {
      chatId: CHAT_ID,
      isPollMessage: false,
      audio: new Uint8Array([1, 2, 3]),
    });

    expect(harness.socket.emit).toHaveBeenCalledTimes(3);
    expect(uploadAudioToCloudinary).not.toHaveBeenCalled();
    expect(uploadEncryptedAudioToCloudinary).not.toHaveBeenCalled();
  });

  it("accepts the frontend voice-note shape with empty non-poll metadata", async () => {
    vi.mocked(uploadAudioToCloudinary).mockResolvedValue({
      public_id: "audio-id",
      secure_url: "https://example.test/audio",
    } as never);
    const harness = await createHarness();

    await harness.trigger(Events.MESSAGE, {
      chatId: CHAT_ID,
      isPollMessage: false,
      pollData: { pollOptions: [] },
      audio: new Uint8Array([1, 2, 3]),
      audioMimeType: "audio/webm",
    });

    expect(uploadAudioToCloudinary).toHaveBeenCalledTimes(1);
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed reaction, vote, and pin payloads before lookup", async () => {
    const harness = await createHarness();
    vi.clearAllMocks();

    await harness.trigger(Events.NEW_REACTION, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      reaction: "x".repeat(33),
    });
    await harness.trigger(Events.VOTE_IN, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      optionIndex: 10,
    });
    await harness.trigger(Events.PIN_MESSAGE, { chatId: "not-an-id", messageId: MESSAGE_ID });

    expect(harness.socket.emit).toHaveBeenCalledTimes(3);
    expect(prisma.message.findFirst).not.toHaveBeenCalled();
  });

  it("returns only the stable invalid-payload category", async () => {
    const harness = await createHarness();

    await harness.trigger(Events.MESSAGE_EDIT, { private: "database detail" });

    expect(harness.socket.emit).toHaveBeenLastCalledWith(Events.SECURITY_ERROR, {
      category: "INVALID_PAYLOAD",
      event: Events.MESSAGE_EDIT,
    });
    expect(JSON.stringify(vi.mocked(harness.socket.emit).mock.calls)).not.toContain("database detail");
  });
});

describe("Socket chat event rate controls", () => {
  it("throttles MESSAGE bursts per user and chat", async () => {
    const harness = await createHarness();
    const payload = { chatId: CHAT_ID, isPollMessage: false, textMessageContent: "hello" };

    for (let index = 0; index < 9; index += 1) await harness.trigger(Events.MESSAGE, payload);

    expect(prisma.message.create).toHaveBeenCalledTimes(8);
    expectSecurityError(harness.socket, "RATE_LIMITED", Events.MESSAGE);
  });

  it("keeps different chat buckets independent", async () => {
    vi.mocked(prisma.chat.findFirst).mockImplementation(async ({ where }: never) => {
      const id = (where as { id: string }).id;
      return memberChat(id) as never;
    });
    const harness = await createHarness();
    for (let index = 0; index < 8; index += 1) {
      await harness.trigger(Events.MESSAGE, {
        chatId: CHAT_ID,
        isPollMessage: false,
        textMessageContent: "chat one",
      });
    }
    await harness.trigger(Events.MESSAGE, {
      chatId: OTHER_CHAT_ID,
      isPollMessage: false,
      textMessageContent: "chat two",
    });

    expect(prisma.message.create).toHaveBeenCalledTimes(9);
  });

  it("allows a normal typing burst and throttles the flood", async () => {
    const harness = await createHarness();

    for (let index = 0; index < 6; index += 1) {
      await harness.trigger(Events.USER_TYPING, { chatId: CHAT_ID });
    }

    expect(harness.broadcastRoomEmit).toHaveBeenCalledTimes(5);
    expectSecurityError(harness.socket, "RATE_LIMITED", Events.USER_TYPING);
  });

  it("coalesces repeated seen mutations by user and chat", async () => {
    vi.mocked(prisma.unreadMessages.findUnique).mockResolvedValue({ id: "unread" } as never);
    const harness = await createHarness();

    for (let index = 0; index < 21; index += 1) {
      await harness.trigger(Events.MESSAGE_SEEN, { chatId: CHAT_ID });
    }

    expect(prisma.unreadMessages.update).toHaveBeenCalledTimes(20);
    expectSecurityError(harness.socket, "RATE_LIMITED", Events.MESSAGE_SEEN);
  });

  it("throttles duplicate reaction mutations", async () => {
    const harness = await createHarness();

    for (let index = 0; index < 7; index += 1) {
      await harness.trigger(Events.NEW_REACTION, {
        chatId: CHAT_ID,
        messageId: MESSAGE_ID,
        reaction: "👍",
      });
    }

    expect(prisma.reactions.create).toHaveBeenCalledTimes(6);
    expectSecurityError(harness.socket, "RATE_LIMITED", Events.NEW_REACTION);
  });

  it("throttles duplicate vote and pin mutations independently", async () => {
    vi.mocked(prisma.message.findFirst).mockResolvedValue(accessibleMessage({ pollId: POLL_ID }) as never);
    const voteHarness = await createHarness();
    for (let index = 0; index < 7; index += 1) {
      await voteHarness.trigger(Events.VOTE_IN, {
        chatId: CHAT_ID,
        messageId: MESSAGE_ID,
        optionIndex: 1,
      });
    }
    expect(prisma.vote.create).toHaveBeenCalledTimes(6);
    expectSecurityError(voteHarness.socket, "RATE_LIMITED", Events.VOTE_IN);

    vi.clearAllMocks();
    vi.mocked(prisma.message.findFirst).mockResolvedValue(accessibleMessage() as never);
    vi.mocked(prisma.pinnedMessages.findMany).mockResolvedValue([]);
    vi.mocked(prisma.pinnedMessages.create).mockResolvedValue({ id: PIN_ID } as never);
    vi.mocked(prisma.message.update).mockResolvedValue({} as never);
    const pinHarness = await createHarness();
    for (let index = 0; index < 5; index += 1) {
      await pinHarness.trigger(Events.PIN_MESSAGE, { chatId: CHAT_ID, messageId: MESSAGE_ID });
    }
    expect(prisma.pinnedMessages.create).toHaveBeenCalledTimes(4);
    expectSecurityError(pinHarness.socket, "RATE_LIMITED", Events.PIN_MESSAGE);
  });
});

describe("authorization remains authoritative", () => {
  it("does not let rate control replace chat membership authorization", async () => {
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(null);
    const harness = await createHarness();
    vi.mocked(harness.socket.emit).mockClear();

    await harness.trigger(Events.MESSAGE, {
      chatId: CHAT_ID,
      isPollMessage: false,
      textMessageContent: "unauthorized",
    });

    expect(prisma.chat.findFirst).toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(harness.roomEmit).not.toHaveBeenCalled();
    expect(harness.socket.emit).not.toHaveBeenCalledWith(
      Events.SECURITY_ERROR,
      expect.objectContaining({ category: "RATE_LIMITED" }),
    );
  });

  it("does not treat socket room membership as DB authorization", async () => {
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(null);
    const harness = await createHarness();

    expect(harness.socket.rooms.has(CHAT_ID)).toBe(true);
    await harness.trigger(Events.USER_TYPING, { chatId: CHAT_ID });
    expect(harness.broadcastRoomEmit).not.toHaveBeenCalled();
  });

  it("never sends internal exception details to the client", async () => {
    vi.mocked(prisma.chat.findFirst).mockRejectedValue(new Error("secret Prisma failure"));
    const harness = await createHarness();
    vi.mocked(harness.socket.emit).mockClear();

    await harness.trigger(Events.USER_TYPING, { chatId: CHAT_ID });

    expect(JSON.stringify(vi.mocked(harness.socket.emit).mock.calls)).not.toContain("secret Prisma failure");
  });

  it("sanitizes known application failures without changing the Socket client contract", async () => {
    const applicationError = new ApplicationError({
      code: "FORBIDDEN",
      message: "Operation is not permitted",
      statusCode: 403,
    });
    vi.mocked(prisma.chat.findFirst).mockRejectedValue(applicationError);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = await createHarness();
    vi.mocked(harness.socket.emit).mockClear();

    await harness.trigger(Events.USER_TYPING, { chatId: CHAT_ID });

    const clientOutput = JSON.stringify(vi.mocked(harness.socket.emit).mock.calls);
    const logOutput = JSON.stringify(errorSpy.mock.calls);
    expect(clientOutput).not.toContain(applicationError.message);
    expect(clientOutput).not.toContain(applicationError.code);
    expect(logOutput).toContain("FORBIDDEN");
    expect(logOutput).not.toContain(applicationError.message);
  });
});
