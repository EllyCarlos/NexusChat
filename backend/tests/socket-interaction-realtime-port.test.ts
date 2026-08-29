import type { Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    reactions: {
      findFirst: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    vote: {
      findFirst: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    pinnedMessages: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    message: { update: vi.fn() },
  },
}));

vi.mock("../src/services/authorization.service.js", () => ({
  assertChatMember: vi.fn(),
  assertMessageAccessible: vi.fn(),
  assertPinAccessible: vi.fn(),
}));

vi.mock("../src/utils/safe-logger.utils.js", () => ({ logServerError: vi.fn() }));

import { Events } from "../src/enums/event/event.enum.js";
import { prisma } from "../src/lib/prisma.lib.js";
import {
  assertChatMember,
  assertMessageAccessible,
  assertPinAccessible,
} from "../src/services/authorization.service.js";
import { registerPinHandlers } from "../src/socket/handlers/pin.handlers.js";
import { registerPollHandlers } from "../src/socket/handlers/poll.handlers.js";
import { registerReactionHandlers } from "../src/socket/handlers/reaction.handlers.js";
import { registerTypingHandlers } from "../src/socket/handlers/typing.handlers.js";
import type { ChatInteractionRealtimePort } from "../src/socket/realtime/contracts/interaction-realtime.port.js";
import type { SocketEventRateLimiter } from "../src/socket/socket-security.js";

const ACTOR_ID = "cm43000000000000000000001";
const CHAT_ID = "cm43000000000000000000002";
const MESSAGE_ID = "cm43000000000000000000003";
const AUTHORIZED_MESSAGE_ID = "cm43000000000000000000004";
const POLL_ID = "cm43000000000000000000005";
const PIN_ID = "cm43000000000000000000006";
const OLD_PIN_ID = "cm43000000000000000000007";
const OLD_MESSAGE_ID = "cm43000000000000000000008";

type EventHandler = (payload?: unknown) => Promise<void> | void;

const pinnedPayload = {
  id: PIN_ID,
  createdAt: new Date("2026-08-03T12:00:00.000Z"),
  updatedAt: new Date("2026-08-03T12:01:00.000Z"),
  message: {
    id: AUTHORIZED_MESSAGE_ID,
    isTextMessage: true,
    textMessageContent: "pinned",
    chatId: CHAT_ID,
    url: null,
    isPollMessage: false,
    audioUrl: null,
    audioPublicId: "existing-audio-public-id",
    isEdited: false,
    replyToMessageId: null,
    isPinned: true,
    createdAt: new Date("2026-08-03T11:59:00.000Z"),
    updatedAt: new Date("2026-08-03T12:01:00.000Z"),
    sender: {
      id: ACTOR_ID,
      username: "port-actor",
      avatar: "port-actor-avatar",
    },
    attachments: [],
    poll: null,
    reactions: [],
    replyToMessage: null,
  },
};

const createRealtime = () => ({
  emitNewReaction: vi.fn(),
  emitDeleteReaction: vi.fn(),
  broadcastTypingToOthers: vi.fn(),
  emitVoteIn: vi.fn(),
  emitVoteOut: vi.fn(),
  emitPinLimitReached: vi.fn(),
  emitPinMessage: vi.fn(),
  emitUnpinMessage: vi.fn(),
}) satisfies ChatInteractionRealtimePort;

const createHarness = () => {
  const handlers = new Map<string, EventHandler>();
  const socket = {
    user: {
      id: ACTOR_ID,
      username: "port-actor",
      avatar: "port-actor-avatar",
    },
    on: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, handler);
      return socket;
    }),
    emit: vi.fn(),
  };
  const limiter = {
    consumeAll: vi.fn(() => true),
  } as unknown as SocketEventRateLimiter;
  const realtime = createRealtime();
  const dependencies = {
    socket: socket as unknown as Socket,
    userId: ACTOR_ID,
    limiter,
    realtime,
  };

  registerReactionHandlers(dependencies);
  registerTypingHandlers(dependencies);
  registerPollHandlers(dependencies);
  registerPinHandlers(dependencies);

  return {
    realtime,
    trigger: async (event: Events, payload: unknown) => {
      const handler = handlers.get(event);
      expect(handler).toBeDefined();
      await handler!(payload);
    },
  };
};

const expectBefore = (
  first: { mock: { invocationCallOrder: number[] } },
  second: { mock: { invocationCallOrder: number[] } },
) => {
  expect(first.mock.invocationCallOrder[0]).toBeLessThan(
    second.mock.invocationCallOrder[0],
  );
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(assertChatMember).mockResolvedValue({ id: CHAT_ID } as never);
  vi.mocked(assertMessageAccessible).mockResolvedValue({
    id: AUTHORIZED_MESSAGE_ID,
    chatId: CHAT_ID,
    senderId: ACTOR_ID,
    pollId: POLL_ID,
    attachments: [],
    audioPublicId: null,
  } as never);
  vi.mocked(assertPinAccessible).mockResolvedValue({
    id: PIN_ID,
    chatId: CHAT_ID,
    messageId: AUTHORIZED_MESSAGE_ID,
  });
  vi.mocked(prisma.reactions.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.reactions.create).mockResolvedValue({ id: "reaction-id" } as never);
  vi.mocked(prisma.reactions.deleteMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.vote.findFirst).mockResolvedValue({ id: "vote-id" } as never);
  vi.mocked(prisma.vote.create).mockResolvedValue({ id: "vote-id" } as never);
  vi.mocked(prisma.vote.deleteMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.pinnedMessages.findMany).mockResolvedValue([]);
  vi.mocked(prisma.pinnedMessages.create).mockResolvedValue(pinnedPayload as never);
  vi.mocked(prisma.pinnedMessages.delete).mockResolvedValue({
    id: PIN_ID,
    chatId: CHAT_ID,
    messageId: AUTHORIZED_MESSAGE_ID,
  } as never);
  vi.mocked(prisma.message.update).mockResolvedValue({ id: AUTHORIZED_MESSAGE_ID } as never);
});

describe("Socket interaction handler realtime port", () => {
  it("delivers NEW_REACTION after persistence with the trusted actor payload", async () => {
    const harness = createHarness();

    await harness.trigger(Events.NEW_REACTION, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      reaction: "like",
    });

    expectBefore(prisma.reactions.create, harness.realtime.emitNewReaction);
    expect(harness.realtime.emitNewReaction).toHaveBeenCalledExactlyOnceWith(CHAT_ID, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      user: {
        id: ACTOR_ID,
        username: "port-actor",
        avatar: "port-actor-avatar",
      },
      reaction: "like",
    });
  });

  it("delivers DELETE_REACTION after deleteMany", async () => {
    const harness = createHarness();

    await harness.trigger(Events.DELETE_REACTION, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
    });

    expectBefore(prisma.reactions.deleteMany, harness.realtime.emitDeleteReaction);
    expect(harness.realtime.emitDeleteReaction).toHaveBeenCalledExactlyOnceWith(CHAT_ID, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      userId: ACTOR_ID,
    });
  });

  it("uses the explicit sender-excluding typing delivery after authorization", async () => {
    const harness = createHarness();

    await harness.trigger(Events.USER_TYPING, { chatId: CHAT_ID });

    expectBefore(vi.mocked(assertChatMember), harness.realtime.broadcastTypingToOthers);
    expect(harness.realtime.broadcastTypingToOthers).toHaveBeenCalledExactlyOnceWith(CHAT_ID, {
      user: {
        id: ACTOR_ID,
        username: "port-actor",
        avatar: "port-actor-avatar",
      },
      chatId: CHAT_ID,
    });
  });

  it("delivers VOTE_IN after vote creation", async () => {
    const harness = createHarness();

    await harness.trigger(Events.VOTE_IN, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      optionIndex: 1,
    });

    expectBefore(prisma.vote.create, harness.realtime.emitVoteIn);
    expect(harness.realtime.emitVoteIn).toHaveBeenCalledExactlyOnceWith(CHAT_ID, {
      messageId: MESSAGE_ID,
      optionIndex: 1,
      user: {
        id: ACTOR_ID,
        avatar: "port-actor-avatar",
        username: "port-actor",
      },
      chatId: CHAT_ID,
    });
  });

  it("delivers VOTE_OUT after vote deletion", async () => {
    const harness = createHarness();

    await harness.trigger(Events.VOTE_OUT, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      optionIndex: 1,
    });

    expectBefore(prisma.vote.deleteMany, harness.realtime.emitVoteOut);
    expect(harness.realtime.emitVoteOut).toHaveBeenCalledExactlyOnceWith(CHAT_ID, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      optionIndex: 1,
      userId: ACTOR_ID,
    });
  });

  it("delivers PIN_MESSAGE after the new pin flag update", async () => {
    const harness = createHarness();

    await harness.trigger(Events.PIN_MESSAGE, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
    });

    expectBefore(prisma.pinnedMessages.create, prisma.message.update);
    expectBefore(prisma.message.update, harness.realtime.emitPinMessage);
    expect(harness.realtime.emitPinLimitReached).not.toHaveBeenCalled();
    expect(harness.realtime.emitPinMessage).toHaveBeenCalledExactlyOnceWith(
      CHAT_ID,
      pinnedPayload,
    );
  });

  it("delivers PIN_LIMIT_REACHED before replacement creation, then delivers PIN_MESSAGE", async () => {
    vi.mocked(prisma.pinnedMessages.findMany).mockResolvedValue([
      { id: OLD_PIN_ID, messageId: OLD_MESSAGE_ID },
      { id: "second-pin", messageId: "second-message" },
      { id: "third-pin", messageId: "third-message" },
    ] as never);
    vi.mocked(prisma.message.update)
      .mockResolvedValueOnce({ id: OLD_MESSAGE_ID } as never)
      .mockResolvedValueOnce({ id: AUTHORIZED_MESSAGE_ID } as never);
    const harness = createHarness();

    await harness.trigger(Events.PIN_MESSAGE, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
    });

    expectBefore(prisma.pinnedMessages.delete, prisma.message.update);
    expectBefore(prisma.message.update, harness.realtime.emitPinLimitReached);
    expectBefore(harness.realtime.emitPinLimitReached, prisma.pinnedMessages.create);
    expectBefore(prisma.pinnedMessages.create, harness.realtime.emitPinMessage);
    expect(harness.realtime.emitPinLimitReached).toHaveBeenCalledExactlyOnceWith(CHAT_ID, {
      oldestPinId: OLD_PIN_ID,
      messageId: OLD_MESSAGE_ID,
      chatId: CHAT_ID,
    });
    expect(harness.realtime.emitPinMessage).toHaveBeenCalledExactlyOnceWith(
      CHAT_ID,
      pinnedPayload,
    );
  });

  it("delivers UNPIN_MESSAGE using the deleted pin's chat after both writes", async () => {
    const harness = createHarness();

    await harness.trigger(Events.UNPIN_MESSAGE, { pinId: PIN_ID });

    expectBefore(prisma.pinnedMessages.delete, prisma.message.update);
    expectBefore(prisma.message.update, harness.realtime.emitUnpinMessage);
    expect(harness.realtime.emitUnpinMessage).toHaveBeenCalledExactlyOnceWith(CHAT_ID, {
      pinId: PIN_ID,
      chatId: CHAT_ID,
      messageId: AUTHORIZED_MESSAGE_ID,
    });
  });
});
