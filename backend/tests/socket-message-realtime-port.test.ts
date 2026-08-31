import type { Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
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
    reactions: { deleteMany: vi.fn() },
    pinnedMessages: { deleteMany: vi.fn() },
    attachment: { deleteMany: vi.fn() },
  },
}));

vi.mock("../src/services/authorization.service.js", () => ({
  assertChatMember: vi.fn(),
  assertMessageAccessible: vi.fn(),
  assertMessageOwner: vi.fn(),
}));

vi.mock("../src/utils/auth.util.js", () => ({
  deleteFilesFromCloudinary: vi.fn(),
  uploadAudioToCloudinary: vi.fn(),
  uploadEncryptedAudioToCloudinary: vi.fn(),
}));

vi.mock("../src/modules/notifications/push-notification.service.js", () => ({ sendPushNotification: vi.fn() }));
vi.mock("../src/utils/safe-logger.utils.js", () => ({ logServerError: vi.fn() }));

import { Events } from "../src/enums/event/event.enum.js";
import { prisma } from "../src/lib/prisma.lib.js";
import {
  assertChatMember,
  assertMessageOwner,
} from "../src/services/authorization.service.js";
import { registerMessageLifecycleHandlers } from "../src/socket/handlers/message-lifecycle.handlers.js";
import { registerMessageHandlers } from "../src/socket/handlers/message.handlers.js";
import type { MessageRealtimePort } from "../src/socket/realtime/contracts/message-realtime.port.js";
import type { SocketEventRateLimitPort } from "../src/socket/socket-event-rate-limit.port.js";

const ACTOR_ID = "cm42000000000000000000001";
const CHAT_ID = "cm42000000000000000000002";
const MESSAGE_ID = "cm42000000000000000000003";
const CREATED_AT = new Date("2026-08-02T12:00:00.000Z");
const UPDATED_AT = new Date("2026-08-02T12:01:00.000Z");

type EventHandler = (payload?: unknown) => Promise<void> | void;

const createRealtime = () => ({
  emitMessage: vi.fn(),
  emitUnreadMessage: vi.fn(),
  emitMessageSeen: vi.fn(),
  emitMessageEdit: vi.fn(),
  emitMessageDelete: vi.fn(),
}) satisfies MessageRealtimePort;

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
  const consumeAll = vi.fn(async () => true);
  const limiter = {
    consume: vi.fn(async () => true),
    consumeAll,
  } satisfies SocketEventRateLimitPort;
  const realtime = createRealtime();

  registerMessageHandlers({
    socket: socket as unknown as Socket,
    userId: ACTOR_ID,
    limiter,
    realtime,
  });
  registerMessageLifecycleHandlers({
    socket: socket as unknown as Socket,
    userId: ACTOR_ID,
    limiter,
    realtime,
  });

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
  vi.mocked(assertMessageOwner).mockResolvedValue({
    id: MESSAGE_ID,
    chatId: CHAT_ID,
    senderId: ACTOR_ID,
    attachments: [],
    audioPublicId: null,
  } as never);
  vi.mocked(prisma.message.create).mockResolvedValue({
    id: MESSAGE_ID,
    isTextMessage: true,
    isPollMessage: false,
    textMessageContent: "hello",
    url: null,
    audioPublicId: null,
    createdAt: CREATED_AT,
  } as never);
  vi.mocked(prisma.chat.update).mockResolvedValue({
    ChatMembers: [{
      user: {
        id: "recipient-id",
        isOnline: true,
        notificationsEnabled: true,
        fcmToken: "private-token",
      },
    }],
  } as never);
  vi.mocked(prisma.message.findUnique).mockResolvedValue({
    id: MESSAGE_ID,
    isTextMessage: true,
    textMessageContent: "hello",
    chatId: CHAT_ID,
    url: null,
    isPollMessage: false,
    audioUrl: null,
    isEdited: false,
    replyToMessageId: null,
    isPinned: false,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    sender: {
      id: ACTOR_ID,
      username: "port-actor",
      avatar: "port-actor-avatar",
    },
    attachments: [],
    poll: null,
    reactions: [],
    replyToMessage: null,
  } as never);
  vi.mocked(prisma.unreadMessages.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.unreadMessages.create).mockResolvedValue({ id: "unread-id" } as never);
  vi.mocked(prisma.unreadMessages.update).mockResolvedValue({ readAt: UPDATED_AT } as never);
  vi.mocked(prisma.unreadMessages.deleteMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.message.update).mockResolvedValue({ textMessageContent: "persisted edit" } as never);
  vi.mocked(prisma.message.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.message.delete).mockResolvedValue({ id: MESSAGE_ID } as never);
  vi.mocked(prisma.pinnedMessages.deleteMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.reactions.deleteMany).mockResolvedValue({ count: 1 } as never);
});

describe("Socket message handler realtime port", () => {
  it("delivers MESSAGE before unread persistence and UNREAD_MESSAGE after it", async () => {
    const harness = createHarness();

    await harness.trigger(Events.MESSAGE, {
      chatId: CHAT_ID,
      isPollMessage: false,
      textMessageContent: "hello",
    });

    expect(harness.realtime.emitMessage).toHaveBeenCalledExactlyOnceWith(CHAT_ID, {
      id: MESSAGE_ID,
      isTextMessage: true,
      textMessageContent: "hello",
      chatId: CHAT_ID,
      url: null,
      isPollMessage: false,
      audioUrl: null,
      isEdited: false,
      replyToMessageId: null,
      isPinned: false,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      sender: {
        id: ACTOR_ID,
        username: "port-actor",
        avatar: "port-actor-avatar",
      },
      attachments: [],
      poll: null,
      reactions: [],
      replyToMessage: null,
      isNew: true,
    });
    expectBefore(harness.realtime.emitMessage, prisma.unreadMessages.findUnique);
    expectBefore(prisma.unreadMessages.create, harness.realtime.emitUnreadMessage);
    expect(harness.realtime.emitUnreadMessage).toHaveBeenCalledExactlyOnceWith(CHAT_ID, {
      chatId: CHAT_ID,
      message: {
        textMessageContent: "hello",
        url: false,
        attachments: false,
        poll: false,
        audio: false,
        createdAt: CREATED_AT,
      },
      sender: {
        id: ACTOR_ID,
        avatar: "port-actor-avatar",
        username: "port-actor",
      },
    });
  });

  it("delivers MESSAGE_SEEN only after the unread update", async () => {
    vi.mocked(prisma.unreadMessages.findUnique).mockResolvedValue({ id: "unread-id" } as never);
    const harness = createHarness();

    await harness.trigger(Events.MESSAGE_SEEN, { chatId: CHAT_ID });

    expectBefore(prisma.unreadMessages.update, harness.realtime.emitMessageSeen);
    expect(harness.realtime.emitMessageSeen).toHaveBeenCalledExactlyOnceWith(CHAT_ID, {
      user: {
        id: ACTOR_ID,
        username: "port-actor",
        avatar: "port-actor-avatar",
      },
      chatId: CHAT_ID,
      readAt: UPDATED_AT,
    });
  });

  it("delivers MESSAGE_EDIT only after the message update", async () => {
    const harness = createHarness();

    await harness.trigger(Events.MESSAGE_EDIT, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      updatedTextContent: "requested edit",
    });

    expectBefore(prisma.message.update, harness.realtime.emitMessageEdit);
    expect(harness.realtime.emitMessageEdit).toHaveBeenCalledExactlyOnceWith(CHAT_ID, {
      updatedTextMessageContent: "persisted edit",
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
    });
  });

  it("delivers MESSAGE_DELETE only after the destructive workflow", async () => {
    const harness = createHarness();

    await harness.trigger(Events.MESSAGE_DELETE, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
    });

    expectBefore(prisma.pinnedMessages.deleteMany, prisma.message.updateMany);
    expectBefore(prisma.message.updateMany, prisma.unreadMessages.deleteMany);
    expectBefore(prisma.unreadMessages.deleteMany, prisma.reactions.deleteMany);
    expectBefore(prisma.reactions.deleteMany, prisma.message.delete);
    expectBefore(prisma.message.delete, harness.realtime.emitMessageDelete);
    expect(harness.realtime.emitMessageDelete).toHaveBeenCalledExactlyOnceWith(CHAT_ID, {
      messageId: MESSAGE_ID,
      chatId: CHAT_ID,
    });
  });
});
