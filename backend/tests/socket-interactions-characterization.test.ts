import type { Server, Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    user: { update: vi.fn() },
    chatMembers: { findMany: vi.fn() },
    chat: { findFirst: vi.fn(), update: vi.fn() },
    message: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    poll: { create: vi.fn() },
    unreadMessages: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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

vi.mock("../src/utils/auth.util.js", () => ({
  deleteFilesFromCloudinary: vi.fn(),
  uploadAudioToCloudinary: vi.fn(),
  uploadEncryptedAudioToCloudinary: vi.fn(),
}));

vi.mock("../src/modules/notifications/push-notification.service.js", () => ({ sendPushNotification: vi.fn() }));
vi.mock("../src/socket/webrtc/socket.js", () => ({ default: vi.fn() }));

import { Events } from "../src/enums/event/event.enum.js";
import { prisma } from "../src/lib/prisma.lib.js";
import { SocketConnectionRegistry } from "../src/socket/connection-registry.js";
import { LocalSocketEventRateLimitAdapter } from "../src/socket/local-socket-event-rate-limit.adapter.js";
import registerSocketHandlers from "../src/socket/socket.js";
import { SOCKET_EVENT_LIMITS } from "../src/socket/socket-security.js";
import { createCapturingLogger } from "./support/capturing-logger.js";
import { createCapturingMetrics } from "./support/capturing-metrics.js";

const USER_ID = "cm50000000000000000000001";
const CHAT_ID = "cm50000000000000000000002";
const MESSAGE_ID = "cm50000000000000000000003";
const POLL_ID = "cm50000000000000000000004";
const PIN_ID = "cm50000000000000000000005";
const OLD_PIN_ID = "cm50000000000000000000006";
const OLD_MESSAGE_ID = "cm50000000000000000000007";
const DELETED_CHAT_ID = "cm50000000000000000000008";

const ACTOR = {
  id: USER_ID,
  username: "trusted-actor",
  avatar: "trusted-avatar",
};

const authorizedChat = {
  id: CHAT_ID,
  isGroupChat: true,
  adminId: USER_ID,
  avatarCloudinaryPublicId: null,
  ChatMembers: [{ userId: USER_ID }],
};

const authorizedMessage = (pollId: string | null = null) => ({
  id: MESSAGE_ID,
  chatId: CHAT_ID,
  senderId: USER_ID,
  pollId,
  audioPublicId: null,
  attachments: [],
});

const authorizedPin = {
  id: PIN_ID,
  chatId: CHAT_ID,
  messageId: MESSAGE_ID,
};

const emittedPin = {
  id: PIN_ID,
  createdAt: new Date("2026-08-28T08:00:00.000Z"),
  message: { id: MESSAGE_ID, textMessageContent: "pinned" },
};

const authorizedMessageQuery = {
  where: {
    id: MESSAGE_ID,
    chatId: CHAT_ID,
    chat: {
      ChatMembers: {
        some: { userId: USER_ID },
      },
    },
  },
  select: {
    id: true,
    chatId: true,
    senderId: true,
    pollId: true,
    audioPublicId: true,
    attachments: {
      select: { cloudinaryPublicId: true },
    },
  },
};

const authorizedChatQuery = {
  where: {
    id: CHAT_ID,
    ChatMembers: {
      some: { userId: USER_ID },
    },
  },
  select: {
    id: true,
    isGroupChat: true,
    adminId: true,
    avatarCloudinaryPublicId: true,
    ChatMembers: {
      select: { userId: true },
    },
  },
};

const authorizedPinQuery = {
  where: {
    id: PIN_ID,
    chat: {
      ChatMembers: {
        some: { userId: USER_ID },
      },
    },
  },
  select: {
    id: true,
    chatId: true,
    messageId: true,
  },
};

const pinCreateQuery = {
  data: {
    messageId: MESSAGE_ID,
    chatId: CHAT_ID,
  },
  include: {
    message: {
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            avatar: true,
          },
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
                  select: {
                    id: true,
                    username: true,
                    avatar: true,
                  },
                },
              },
              omit: {
                id: true,
                pollId: true,
                userId: true,
              },
            },
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
        replyToMessage: {
          select: {
            sender: {
              select: {
                id: true,
                username: true,
                avatar: true,
              },
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
      omit: {
        senderId: true,
        pollId: true,
      },
    },
  },
  omit: {
    chatId: true,
    messageId: true,
  },
};

type EventHandler = (payload?: unknown) => Promise<void> | void;

type LimiterDouble = {
  consumeAll: ReturnType<typeof vi.fn>;
};

const createHarness = async (
  limiter?: LimiterDouble,
  metrics = createCapturingMetrics(),
) => {
  const handlers = new Map<string, EventHandler>();
  let connectionHandler: ((socket: Socket) => Promise<void>) | undefined;
  const roomEmit = vi.fn();
  const broadcastRoomEmit = vi.fn();
  const socket = {
    id: "socket-interaction-test",
    user: ACTOR,
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
  const selectedLimiter = limiter
    ? {
        consume: vi.fn(async () => true),
        consumeAll: limiter.consumeAll,
      }
    : new LocalSocketEventRateLimitAdapter();
  const logger = createCapturingLogger("socket");

  registerSocketHandlers(io as unknown as Server, {
    registry: new SocketConnectionRegistry(),
    limiter: selectedLimiter,
    logger,
    metrics,
  });
  expect(connectionHandler).toBeDefined();
  await connectionHandler!(socket as unknown as Socket);
  vi.clearAllMocks();

  return {
    broadcastRoomEmit,
    handlers,
    io,
    logger,
    metrics,
    roomEmit,
    socket,
    trigger: async (event: Events, payload: unknown) => {
      const handler = handlers.get(event);
      expect(handler).toBeDefined();
      await handler!(payload);
    },
  };
};

const interactionCases = [
  {
    event: Events.NEW_REACTION,
    payload: { chatId: CHAT_ID, messageId: MESSAGE_ID, reaction: "like" },
    invalidPayload: { chatId: CHAT_ID, messageId: MESSAGE_ID, reaction: "" },
    actorPolicy: SOCKET_EVENT_LIMITS.mutationActor,
    resourcePolicy: SOCKET_EVENT_LIMITS.reactionMessage,
    authorization: () => vi.mocked(prisma.message.findFirst),
    resourceKey: MESSAGE_ID,
    log: "socket.reaction_addition.failed",
    operation: "reaction_add",
  },
  {
    event: Events.DELETE_REACTION,
    payload: { chatId: CHAT_ID, messageId: MESSAGE_ID },
    invalidPayload: { chatId: CHAT_ID, messageId: "invalid" },
    actorPolicy: SOCKET_EVENT_LIMITS.mutationActor,
    resourcePolicy: SOCKET_EVENT_LIMITS.reactionMessage,
    authorization: () => vi.mocked(prisma.message.findFirst),
    resourceKey: MESSAGE_ID,
    log: "socket.reaction_deletion.failed",
    operation: "reaction_delete",
  },
  {
    event: Events.USER_TYPING,
    payload: { chatId: CHAT_ID },
    invalidPayload: { chatId: "invalid" },
    actorPolicy: SOCKET_EVENT_LIMITS.typingActor,
    resourcePolicy: SOCKET_EVENT_LIMITS.typingChat,
    authorization: () => vi.mocked(prisma.chat.findFirst),
    resourceKey: CHAT_ID,
    log: "socket.typing.failed",
    operation: "typing",
  },
  {
    event: Events.VOTE_IN,
    payload: { chatId: CHAT_ID, messageId: MESSAGE_ID, optionIndex: 1 },
    invalidPayload: { chatId: CHAT_ID, messageId: MESSAGE_ID, optionIndex: 10 },
    actorPolicy: SOCKET_EVENT_LIMITS.mutationActor,
    resourcePolicy: SOCKET_EVENT_LIMITS.voteMessage,
    authorization: () => vi.mocked(prisma.message.findFirst),
    resourceKey: MESSAGE_ID,
    log: "socket.poll_vote.failed",
    operation: "poll_vote",
  },
  {
    event: Events.VOTE_OUT,
    payload: { chatId: CHAT_ID, messageId: MESSAGE_ID, optionIndex: 1 },
    invalidPayload: { chatId: CHAT_ID, messageId: MESSAGE_ID, optionIndex: -1 },
    actorPolicy: SOCKET_EVENT_LIMITS.mutationActor,
    resourcePolicy: SOCKET_EVENT_LIMITS.voteMessage,
    authorization: () => vi.mocked(prisma.message.findFirst),
    resourceKey: MESSAGE_ID,
    log: "socket.poll_vote_removal.failed",
    operation: "poll_vote_remove",
  },
  {
    event: Events.PIN_MESSAGE,
    payload: { chatId: CHAT_ID, messageId: MESSAGE_ID },
    invalidPayload: { chatId: "invalid", messageId: MESSAGE_ID },
    actorPolicy: SOCKET_EVENT_LIMITS.mutationActor,
    resourcePolicy: SOCKET_EVENT_LIMITS.pinMessage,
    authorization: () => vi.mocked(prisma.message.findFirst),
    resourceKey: MESSAGE_ID,
    log: "socket.message_pin.failed",
    operation: "message_pin",
  },
  {
    event: Events.UNPIN_MESSAGE,
    payload: { pinId: PIN_ID },
    invalidPayload: { pinId: "invalid" },
    actorPolicy: SOCKET_EVENT_LIMITS.mutationActor,
    resourcePolicy: SOCKET_EVENT_LIMITS.pinMessage,
    authorization: () => vi.mocked(prisma.pinnedMessages.findFirst),
    resourceKey: MESSAGE_ID,
    log: "socket.message_unpin.failed",
    operation: "message_unpin",
  },
] as const;

const expectNoInteractionPersistence = () => {
  expect(prisma.reactions.findFirst).not.toHaveBeenCalled();
  expect(prisma.reactions.create).not.toHaveBeenCalled();
  expect(prisma.reactions.deleteMany).not.toHaveBeenCalled();
  expect(prisma.vote.findFirst).not.toHaveBeenCalled();
  expect(prisma.vote.create).not.toHaveBeenCalled();
  expect(prisma.vote.deleteMany).not.toHaveBeenCalled();
  expect(prisma.pinnedMessages.findMany).not.toHaveBeenCalled();
  expect(prisma.pinnedMessages.create).not.toHaveBeenCalled();
  expect(prisma.pinnedMessages.delete).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.update).mockResolvedValue({} as never);
  vi.mocked(prisma.chatMembers.findMany).mockResolvedValue([]);
  vi.mocked(prisma.chat.findFirst).mockResolvedValue(authorizedChat as never);
  vi.mocked(prisma.message.findFirst).mockResolvedValue(authorizedMessage() as never);
  vi.mocked(prisma.message.update).mockResolvedValue({} as never);
  vi.mocked(prisma.reactions.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.reactions.create).mockResolvedValue({ id: "reaction-id" } as never);
  vi.mocked(prisma.reactions.deleteMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.vote.findFirst).mockResolvedValue({ id: "vote-id" } as never);
  vi.mocked(prisma.vote.create).mockResolvedValue({ id: "vote-id" } as never);
  vi.mocked(prisma.vote.deleteMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.pinnedMessages.findFirst).mockResolvedValue(authorizedPin as never);
  vi.mocked(prisma.pinnedMessages.findMany).mockResolvedValue([]);
  vi.mocked(prisma.pinnedMessages.create).mockResolvedValue(emittedPin as never);
  vi.mocked(prisma.pinnedMessages.delete).mockResolvedValue(authorizedPin as never);
});

describe("Socket interaction parse and limiter ordering", () => {
  it.each(interactionCases)("parses $event before limiter, authorization, and mutation work", async ({
    event,
    invalidPayload,
  }) => {
    const consumeAll = vi.fn().mockResolvedValue(true);
    const harness = await createHarness({ consumeAll });

    await harness.trigger(event, invalidPayload);

    expect(harness.socket.emit).toHaveBeenCalledWith(Events.SECURITY_ERROR, {
      category: "INVALID_PAYLOAD",
      event,
    });
    expect(consumeAll).not.toHaveBeenCalled();
    expect(prisma.chat.findFirst).not.toHaveBeenCalled();
    expect(prisma.message.findFirst).not.toHaveBeenCalled();
    expect(prisma.pinnedMessages.findFirst).not.toHaveBeenCalled();
    expectNoInteractionPersistence();
    expect(harness.io.to).not.toHaveBeenCalled();
    expect(harness.socket.broadcast.to).not.toHaveBeenCalled();
  });

  it.each(interactionCases)("cuts off $event at the actor-level limiter before authorization", async ({
    actorPolicy,
    event,
    operation,
    payload,
  }) => {
    const consumeAll = vi.fn().mockResolvedValue(false);
    const harness = await createHarness({ consumeAll });

    await harness.trigger(event, payload);

    expect(consumeAll).toHaveBeenCalledOnce();
    expect(consumeAll).toHaveBeenCalledWith([actorPolicy], [USER_ID]);
    expect(prisma.chat.findFirst).not.toHaveBeenCalled();
    expect(prisma.message.findFirst).not.toHaveBeenCalled();
    expect(prisma.pinnedMessages.findFirst).not.toHaveBeenCalled();
    expectNoInteractionPersistence();
    expect(harness.socket.emit).toHaveBeenCalledWith(Events.SECURITY_ERROR, {
      category: "RATE_LIMITED",
      event,
    });
    expect(harness.metrics.socketRateLimitRejections).toEqual([operation]);
  });

  it.each(interactionCases)("authorizes $event before its resource-level limiter and mutation", async ({
    actorPolicy,
    authorization,
    event,
    operation,
    payload,
    resourceKey,
    resourcePolicy,
  }) => {
    const consumeAll = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const harness = await createHarness({ consumeAll });

    await harness.trigger(event, payload);

    const authorizationMock = authorization();
    expect(consumeAll).toHaveBeenNthCalledWith(1, [actorPolicy], [USER_ID]);
    expect(authorizationMock).toHaveBeenCalledOnce();
    expect(consumeAll).toHaveBeenNthCalledWith(2, [resourcePolicy], [USER_ID, resourceKey]);
    expect(consumeAll.mock.invocationCallOrder[0]).toBeLessThan(
      authorizationMock.mock.invocationCallOrder[0],
    );
    expect(authorizationMock.mock.invocationCallOrder[0]).toBeLessThan(
      consumeAll.mock.invocationCallOrder[1],
    );
    expectNoInteractionPersistence();
    expect(harness.roomEmit).not.toHaveBeenCalled();
    expect(harness.broadcastRoomEmit).not.toHaveBeenCalled();
    expect(harness.metrics.socketOperationFailures).toEqual([]);
    expect(harness.socket.emit).toHaveBeenCalledWith(Events.SECURITY_ERROR, {
      category: "RATE_LIMITED",
      event,
    });
    expect(harness.metrics.socketRateLimitRejections).toEqual([operation]);
  });
});

describe("Socket interaction error boundaries", () => {
  it.each(interactionCases)("safe-logs the exact $event failure context without client details", async ({
    authorization,
    event,
    log,
    operation,
    payload,
  }) => {
    const privateFailure = new Error(`private-${event}-database-detail`);
    const harness = await createHarness();
    authorization().mockRejectedValueOnce(privateFailure as never);

    await harness.trigger(event, payload);

    expect(harness.logger.events).toContainEqual({
      level: "error",
      component: "socket",
      event: log,
      fields: { operation, result: "failed", errorType: "Error" },
    });
    expect(JSON.stringify(harness.logger.events)).not.toContain(privateFailure.message);
    expect(JSON.stringify(harness.socket.emit.mock.calls)).not.toContain(privateFailure.message);
    expectNoInteractionPersistence();
    expect(harness.roomEmit).not.toHaveBeenCalled();
    expect(harness.broadcastRoomEmit).not.toHaveBeenCalled();
    expect(harness.metrics.socketOperationFailures).toEqual([operation]);
  });

  const roomDeliveryFailureCases = [
    {
      event: Events.NEW_REACTION,
      payload: { chatId: CHAT_ID, messageId: MESSAGE_ID, reaction: "like" },
      prepare: () => undefined,
      completedWrite: () => vi.mocked(prisma.reactions.create),
      log: "socket.reaction_addition.failed",
      operation: "reaction_add",
    },
    {
      event: Events.DELETE_REACTION,
      payload: { chatId: CHAT_ID, messageId: MESSAGE_ID },
      prepare: () => undefined,
      completedWrite: () => vi.mocked(prisma.reactions.deleteMany),
      log: "socket.reaction_deletion.failed",
      operation: "reaction_delete",
    },
    {
      event: Events.VOTE_IN,
      payload: { chatId: CHAT_ID, messageId: MESSAGE_ID, optionIndex: 1 },
      prepare: () => {
        vi.mocked(prisma.message.findFirst).mockResolvedValue(authorizedMessage(POLL_ID) as never);
      },
      completedWrite: () => vi.mocked(prisma.vote.create),
      log: "socket.poll_vote.failed",
      operation: "poll_vote",
    },
    {
      event: Events.VOTE_OUT,
      payload: { chatId: CHAT_ID, messageId: MESSAGE_ID, optionIndex: 1 },
      prepare: () => {
        vi.mocked(prisma.message.findFirst).mockResolvedValue(authorizedMessage(POLL_ID) as never);
      },
      completedWrite: () => vi.mocked(prisma.vote.deleteMany),
      log: "socket.poll_vote_removal.failed",
      operation: "poll_vote_remove",
    },
    {
      event: Events.PIN_MESSAGE,
      payload: { chatId: CHAT_ID, messageId: MESSAGE_ID },
      prepare: () => undefined,
      completedWrite: () => vi.mocked(prisma.message.update),
      log: "socket.message_pin.failed",
      operation: "message_pin",
    },
    {
      event: Events.UNPIN_MESSAGE,
      payload: { pinId: PIN_ID },
      prepare: () => undefined,
      completedWrite: () => vi.mocked(prisma.message.update),
      log: "socket.message_unpin.failed",
      operation: "message_unpin",
    },
  ] as const;

  it.each(roomDeliveryFailureCases)(
    "preserves completed persistence and safe-logs a thrown $event room delivery",
    async ({ completedWrite, event, log, operation, payload, prepare }) => {
      const privateFailure = new Error(`private-${event}-delivery-detail`);
      prepare();
      const harness = await createHarness();
      harness.roomEmit.mockImplementationOnce(() => {
        throw privateFailure;
      });

      await harness.trigger(event, payload);

      expect(completedWrite()).toHaveBeenCalled();
      expect(harness.io.to).toHaveBeenCalled();
      expect(harness.roomEmit).toHaveBeenCalledOnce();
      expect(harness.logger.events).toContainEqual({
        level: "error",
        component: "socket",
        event: log,
        fields: { operation, result: "failed", errorType: "Error" },
      });
      expect(JSON.stringify(harness.logger.events)).not.toContain(privateFailure.message);
      expect(JSON.stringify(harness.socket.emit.mock.calls)).not.toContain(privateFailure.message);
      expect(harness.metrics.socketOperationFailures).toEqual([operation]);
    },
  );

  it("safe-logs a thrown typing broadcast while retaining sender exclusion", async () => {
    const privateFailure = new Error("private-typing-delivery-detail");
    const harness = await createHarness();
    harness.broadcastRoomEmit.mockImplementationOnce(() => {
      throw privateFailure;
    });

    await harness.trigger(Events.USER_TYPING, { chatId: CHAT_ID });

    expect(harness.socket.broadcast.to).toHaveBeenCalledWith(CHAT_ID);
    expect(harness.broadcastRoomEmit).toHaveBeenCalledWith(Events.USER_TYPING, {
      user: ACTOR,
      chatId: CHAT_ID,
    });
    expect(harness.io.to).not.toHaveBeenCalled();
    expect(harness.logger.events.at(-1)).toMatchObject({
      level: "error",
      component: "socket",
      event: "socket.typing.failed",
      fields: { operation: "typing", result: "failed", errorType: "Error" },
    });
    expect(JSON.stringify(harness.logger.events)).not.toContain(privateFailure.message);
    expect(JSON.stringify(harness.socket.emit.mock.calls)).not.toContain(privateFailure.message);
    expect(harness.metrics.socketOperationFailures).toEqual(["typing"]);
  });

  it("stops pin replacement work and safe-logs when PIN_LIMIT_REACHED delivery throws", async () => {
    vi.mocked(prisma.pinnedMessages.findMany).mockResolvedValue([
      { id: OLD_PIN_ID, messageId: OLD_MESSAGE_ID },
      { id: "second-pin", messageId: "second-message" },
      { id: "third-pin", messageId: "third-message" },
    ] as never);
    vi.mocked(prisma.message.update).mockResolvedValueOnce({ id: OLD_MESSAGE_ID } as never);
    const privateFailure = new Error("private-pin-limit-delivery-detail");
    const harness = await createHarness();
    harness.roomEmit.mockImplementationOnce(() => {
      throw privateFailure;
    });

    await harness.trigger(Events.PIN_MESSAGE, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
    });

    expect(prisma.pinnedMessages.delete).toHaveBeenCalledWith({ where: { id: OLD_PIN_ID } });
    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: OLD_MESSAGE_ID },
      data: { isPinned: false },
      select: { id: true },
    });
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.PIN_LIMIT_REACHED, {
      oldestPinId: OLD_PIN_ID,
      messageId: OLD_MESSAGE_ID,
      chatId: CHAT_ID,
    });
    expect(prisma.pinnedMessages.create).not.toHaveBeenCalled();
    expect(prisma.message.update).toHaveBeenCalledOnce();
    expect(harness.logger.events.at(-1)).toMatchObject({
      event: "socket.message_pin.failed",
      fields: { operation: "message_pin", result: "failed", errorType: "Error" },
    });
    expect(JSON.stringify(harness.logger.events)).not.toContain(privateFailure.message);
    expect(JSON.stringify(harness.socket.emit.mock.calls)).not.toContain(privateFailure.message);
  });
});

describe("Socket reaction characterization", () => {
  it("adds a reaction with exact authorization, actor persistence, payload, target, and order", async () => {
    const harness = await createHarness();

    await harness.trigger(Events.NEW_REACTION, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      reaction: "celebrate",
    });

    expect(prisma.message.findFirst).toHaveBeenCalledWith(authorizedMessageQuery);
    expect(prisma.reactions.findFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID, messageId: MESSAGE_ID },
    });
    expect(prisma.reactions.create).toHaveBeenCalledWith({
      data: { reaction: "celebrate", userId: USER_ID, messageId: MESSAGE_ID },
    });
    expect(harness.io.to).toHaveBeenCalledWith(CHAT_ID);
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.NEW_REACTION, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      user: ACTOR,
      reaction: "celebrate",
    });
    expect(vi.mocked(prisma.message.findFirst).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.reactions.findFirst).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(prisma.reactions.findFirst).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.reactions.create).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(prisma.reactions.create).mock.invocationCallOrder[0]).toBeLessThan(
      harness.roomEmit.mock.invocationCallOrder[0],
    );
  });

  it("returns without creation or emission when the actor already has a reaction", async () => {
    vi.mocked(prisma.reactions.findFirst).mockResolvedValue({ id: "existing-reaction" } as never);
    const harness = await createHarness();

    await harness.trigger(Events.NEW_REACTION, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      reaction: "like",
    });

    expect(prisma.reactions.findFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID, messageId: MESSAGE_ID },
    });
    expect(prisma.reactions.create).not.toHaveBeenCalled();
    expect(harness.io.to).not.toHaveBeenCalled();
    expect(harness.roomEmit).not.toHaveBeenCalled();
  });

  it("deletes by trusted actor and emits even when deleteMany reports zero rows", async () => {
    vi.mocked(prisma.reactions.deleteMany).mockResolvedValue({ count: 0 } as never);
    const harness = await createHarness();

    await harness.trigger(Events.DELETE_REACTION, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
    });

    expect(prisma.message.findFirst).toHaveBeenCalledWith(authorizedMessageQuery);
    expect(prisma.reactions.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, messageId: MESSAGE_ID },
    });
    expect(harness.io.to).toHaveBeenCalledWith(CHAT_ID);
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.DELETE_REACTION, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      userId: USER_ID,
    });
  });
});

describe("Socket typing characterization", () => {
  it("authorizes the chat and broadcasts the exact trusted actor payload excluding the sender", async () => {
    const harness = await createHarness();

    await harness.trigger(Events.USER_TYPING, { chatId: CHAT_ID });

    expect(prisma.chat.findFirst).toHaveBeenCalledWith(authorizedChatQuery);
    expect(harness.socket.broadcast.to).toHaveBeenCalledWith(CHAT_ID);
    expect(harness.broadcastRoomEmit).toHaveBeenCalledWith(Events.USER_TYPING, {
      user: ACTOR,
      chatId: CHAT_ID,
    });
    expect(harness.io.to).not.toHaveBeenCalled();
    expect(harness.roomEmit).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.chat.findFirst).mock.invocationCallOrder[0]).toBeLessThan(
      harness.socket.broadcast.to.mock.invocationCallOrder[0],
    );
  });
});

describe("Socket poll-vote characterization", () => {
  it("creates VOTE_IN with the authorized poll and exact room payload", async () => {
    vi.mocked(prisma.message.findFirst).mockResolvedValue(authorizedMessage(POLL_ID) as never);
    const harness = await createHarness();

    await harness.trigger(Events.VOTE_IN, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      optionIndex: 2,
    });

    expect(prisma.message.findFirst).toHaveBeenCalledWith(authorizedMessageQuery);
    expect(prisma.vote.create).toHaveBeenCalledWith({
      data: { pollId: POLL_ID, userId: USER_ID, optionIndex: 2 },
    });
    expect(harness.io.to).toHaveBeenCalledWith(CHAT_ID);
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.VOTE_IN, {
      messageId: MESSAGE_ID,
      optionIndex: 2,
      user: ACTOR,
      chatId: CHAT_ID,
    });
  });

  it("checks both limits but returns before VOTE_IN persistence when the message has no poll", async () => {
    const consumeAll = vi.fn().mockResolvedValue(true);
    const harness = await createHarness({ consumeAll });

    await harness.trigger(Events.VOTE_IN, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      optionIndex: 0,
    });

    expect(consumeAll).toHaveBeenNthCalledWith(1, [SOCKET_EVENT_LIMITS.mutationActor], [USER_ID]);
    expect(consumeAll).toHaveBeenNthCalledWith(2, [SOCKET_EVENT_LIMITS.voteMessage], [USER_ID, MESSAGE_ID]);
    expect(prisma.vote.create).not.toHaveBeenCalled();
    expect(harness.io.to).not.toHaveBeenCalled();
  });

  it("returns before VOTE_OUT deletion and emission when the selected vote is absent", async () => {
    vi.mocked(prisma.message.findFirst).mockResolvedValue(authorizedMessage(POLL_ID) as never);
    vi.mocked(prisma.vote.findFirst).mockResolvedValue(null);
    const harness = await createHarness();

    await harness.trigger(Events.VOTE_OUT, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      optionIndex: 3,
    });

    expect(prisma.vote.findFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID, pollId: POLL_ID, optionIndex: 3 },
    });
    expect(prisma.vote.deleteMany).not.toHaveBeenCalled();
    expect(harness.io.to).not.toHaveBeenCalled();
  });

  it("finds and deletes VOTE_OUT with the same selector before the exact room event", async () => {
    vi.mocked(prisma.message.findFirst).mockResolvedValue(authorizedMessage(POLL_ID) as never);
    const harness = await createHarness();

    await harness.trigger(Events.VOTE_OUT, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      optionIndex: 4,
    });

    const selector = { userId: USER_ID, pollId: POLL_ID, optionIndex: 4 };
    expect(prisma.message.findFirst).toHaveBeenCalledWith(authorizedMessageQuery);
    expect(prisma.vote.findFirst).toHaveBeenCalledWith({ where: selector });
    expect(prisma.vote.deleteMany).toHaveBeenCalledWith({ where: selector });
    expect(harness.io.to).toHaveBeenCalledWith(CHAT_ID);
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.VOTE_OUT, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      optionIndex: 4,
      userId: USER_ID,
    });
    expect(vi.mocked(prisma.vote.findFirst).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.vote.deleteMany).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(prisma.vote.deleteMany).mock.invocationCallOrder[0]).toBeLessThan(
      harness.roomEmit.mock.invocationCallOrder[0],
    );
  });
});

describe("Socket pin characterization", () => {
  it("creates, populates, marks, and emits a pin with the exact projection and order", async () => {
    const harness = await createHarness();

    await harness.trigger(Events.PIN_MESSAGE, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
    });

    expect(prisma.message.findFirst).toHaveBeenCalledWith(authorizedMessageQuery);
    expect(prisma.pinnedMessages.findMany).toHaveBeenCalledWith({
      where: { chatId: CHAT_ID },
      orderBy: { createdAt: "asc" },
    });
    expect(prisma.pinnedMessages.create).toHaveBeenCalledWith(pinCreateQuery);
    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: MESSAGE_ID },
      data: { isPinned: true },
    });
    expect(harness.io.to).toHaveBeenCalledWith(CHAT_ID);
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.PIN_MESSAGE, emittedPin);
    expect(vi.mocked(prisma.pinnedMessages.findMany).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.pinnedMessages.create).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(prisma.pinnedMessages.create).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.message.update).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(prisma.message.update).mock.invocationCallOrder[0]).toBeLessThan(
      harness.roomEmit.mock.invocationCallOrder[0],
    );
  });

  it("evicts only at exactly three pins, emits the limit event, then creates the new pin", async () => {
    vi.mocked(prisma.pinnedMessages.findMany).mockResolvedValue([
      { id: OLD_PIN_ID, messageId: OLD_MESSAGE_ID },
      { id: "second-pin", messageId: "second-message" },
      { id: "third-pin", messageId: "third-message" },
    ] as never);
    vi.mocked(prisma.pinnedMessages.delete).mockResolvedValue({ id: OLD_PIN_ID } as never);
    vi.mocked(prisma.message.update)
      .mockResolvedValueOnce({ id: OLD_MESSAGE_ID } as never)
      .mockResolvedValueOnce({ id: MESSAGE_ID } as never);
    const harness = await createHarness();

    await harness.trigger(Events.PIN_MESSAGE, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
    });

    expect(prisma.pinnedMessages.delete).toHaveBeenCalledWith({ where: { id: OLD_PIN_ID } });
    expect(prisma.message.update).toHaveBeenNthCalledWith(1, {
      where: { id: OLD_MESSAGE_ID },
      data: { isPinned: false },
      select: { id: true },
    });
    expect(harness.roomEmit).toHaveBeenNthCalledWith(1, Events.PIN_LIMIT_REACHED, {
      oldestPinId: OLD_PIN_ID,
      messageId: OLD_MESSAGE_ID,
      chatId: CHAT_ID,
    });
    expect(prisma.pinnedMessages.create).toHaveBeenCalledWith(pinCreateQuery);
    expect(prisma.message.update).toHaveBeenNthCalledWith(2, {
      where: { id: MESSAGE_ID },
      data: { isPinned: true },
    });
    expect(harness.roomEmit).toHaveBeenNthCalledWith(2, Events.PIN_MESSAGE, emittedPin);
    expect(vi.mocked(prisma.pinnedMessages.delete).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.message.update).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(prisma.message.update).mock.invocationCallOrder[0]).toBeLessThan(
      harness.roomEmit.mock.invocationCallOrder[0],
    );
    expect(harness.roomEmit.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.pinnedMessages.create).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(prisma.pinnedMessages.create).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.message.update).mock.invocationCallOrder[1],
    );
    expect(vi.mocked(prisma.message.update).mock.invocationCallOrder[1]).toBeLessThan(
      harness.roomEmit.mock.invocationCallOrder[1],
    );
  });

  it("preserves the legacy equality rule and does not evict when more than three pins exist", async () => {
    vi.mocked(prisma.pinnedMessages.findMany).mockResolvedValue([
      { id: "pin-1", messageId: "message-1" },
      { id: "pin-2", messageId: "message-2" },
      { id: "pin-3", messageId: "message-3" },
      { id: "pin-4", messageId: "message-4" },
    ] as never);
    const harness = await createHarness();

    await harness.trigger(Events.PIN_MESSAGE, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
    });

    expect(prisma.pinnedMessages.delete).not.toHaveBeenCalled();
    expect(harness.roomEmit).not.toHaveBeenCalledWith(Events.PIN_LIMIT_REACHED, expect.anything());
    expect(prisma.pinnedMessages.create).toHaveBeenCalledWith(pinCreateQuery);
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.PIN_MESSAGE, emittedPin);
  });

  it("leaves the oldest pin row deleted when clearing its message flag fails", async () => {
    vi.mocked(prisma.pinnedMessages.findMany).mockResolvedValue([
      { id: OLD_PIN_ID, messageId: OLD_MESSAGE_ID },
      { id: "second-pin", messageId: "second-message" },
      { id: "third-pin", messageId: "third-message" },
    ] as never);
    vi.mocked(prisma.message.update).mockRejectedValueOnce(new Error("old flag failure"));
    const harness = await createHarness();

    await harness.trigger(Events.PIN_MESSAGE, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
    });

    expect(prisma.pinnedMessages.delete).toHaveBeenCalledWith({ where: { id: OLD_PIN_ID } });
    expect(prisma.pinnedMessages.create).not.toHaveBeenCalled();
    expect(harness.roomEmit).not.toHaveBeenCalled();
    expect(harness.logger.events.at(-1)).toMatchObject({ event: "socket.message_pin.failed" });
  });

  it("keeps the completed eviction and limit event when creating the replacement fails", async () => {
    vi.mocked(prisma.pinnedMessages.findMany).mockResolvedValue([
      { id: OLD_PIN_ID, messageId: OLD_MESSAGE_ID },
      { id: "second-pin", messageId: "second-message" },
      { id: "third-pin", messageId: "third-message" },
    ] as never);
    vi.mocked(prisma.message.update).mockResolvedValueOnce({ id: OLD_MESSAGE_ID } as never);
    vi.mocked(prisma.pinnedMessages.create).mockRejectedValueOnce(new Error("replacement failure"));
    const harness = await createHarness();

    await harness.trigger(Events.PIN_MESSAGE, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
    });

    expect(harness.roomEmit).toHaveBeenCalledWith(Events.PIN_LIMIT_REACHED, {
      oldestPinId: OLD_PIN_ID,
      messageId: OLD_MESSAGE_ID,
      chatId: CHAT_ID,
    });
    expect(prisma.message.update).toHaveBeenCalledTimes(1);
    expect(harness.roomEmit).not.toHaveBeenCalledWith(Events.PIN_MESSAGE, expect.anything());
    expect(harness.logger.events.at(-1)).toMatchObject({ event: "socket.message_pin.failed" });
  });

  it("leaves the created pin row when marking the new message pinned fails", async () => {
    vi.mocked(prisma.message.update).mockRejectedValueOnce(new Error("new flag failure"));
    const harness = await createHarness();

    await harness.trigger(Events.PIN_MESSAGE, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
    });

    expect(prisma.pinnedMessages.create).toHaveBeenCalledWith(pinCreateQuery);
    expect(harness.roomEmit).not.toHaveBeenCalledWith(Events.PIN_MESSAGE, expect.anything());
    expect(harness.logger.events.at(-1)).toMatchObject({ event: "socket.message_pin.failed" });
  });
});

describe("Socket unpin characterization", () => {
  it("authorizes, deletes, clears the flag, and targets the deleted pin chat with exact data", async () => {
    vi.mocked(prisma.pinnedMessages.delete).mockResolvedValue({
      id: PIN_ID,
      chatId: DELETED_CHAT_ID,
      messageId: MESSAGE_ID,
    } as never);
    const harness = await createHarness();

    await harness.trigger(Events.UNPIN_MESSAGE, { pinId: PIN_ID });

    expect(prisma.pinnedMessages.findFirst).toHaveBeenCalledWith(authorizedPinQuery);
    expect(prisma.pinnedMessages.delete).toHaveBeenCalledWith({
      where: { id: PIN_ID },
      select: { id: true, chatId: true, messageId: true },
    });
    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: MESSAGE_ID },
      data: { isPinned: false },
    });
    expect(harness.io.to).toHaveBeenCalledWith(DELETED_CHAT_ID);
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.UNPIN_MESSAGE, {
      pinId: PIN_ID,
      chatId: DELETED_CHAT_ID,
      messageId: MESSAGE_ID,
    });
    expect(vi.mocked(prisma.pinnedMessages.findFirst).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.pinnedMessages.delete).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(prisma.pinnedMessages.delete).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.message.update).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(prisma.message.update).mock.invocationCallOrder[0]).toBeLessThan(
      harness.roomEmit.mock.invocationCallOrder[0],
    );
  });

  it("keeps the pin deletion committed and emits nothing when clearing the message flag fails", async () => {
    vi.mocked(prisma.message.update).mockRejectedValueOnce(new Error("unpin flag failure"));
    const harness = await createHarness();

    await harness.trigger(Events.UNPIN_MESSAGE, { pinId: PIN_ID });

    expect(prisma.pinnedMessages.delete).toHaveBeenCalledTimes(1);
    expect(prisma.message.update).toHaveBeenCalledTimes(1);
    expect(harness.roomEmit).not.toHaveBeenCalled();
    expect(harness.logger.events.at(-1)).toMatchObject({ event: "socket.message_unpin.failed" });
  });
});
