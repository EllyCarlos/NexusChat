import type { Server, Socket } from "socket.io";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    reactions: {
      findFirst: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
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
import { deleteFilesFromCloudinary } from "../src/utils/auth.util.js";

const ACTOR_ID = "cm13000000000000000000001";
const CHAT_ID = "cm13000000000000000000002";
const MESSAGE_ID = "cm13000000000000000000003";
const AUTHORIZED_MESSAGE_ID = "cm13000000000000000000004";
const DELETED_MESSAGE_ID = "cm13000000000000000000005";
const UNREAD_ID = "cm13000000000000000000006";

const chatFindFirst = vi.mocked(prisma.chat.findFirst);
const messageFindFirst = vi.mocked(prisma.message.findFirst);
const messageUpdate = vi.mocked(prisma.message.update);
const messageUpdateMany = vi.mocked(prisma.message.updateMany);
const messageDelete = vi.mocked(prisma.message.delete);
const unreadFindUnique = vi.mocked(prisma.unreadMessages.findUnique);
const unreadUpdate = vi.mocked(prisma.unreadMessages.update);
const unreadDeleteMany = vi.mocked(prisma.unreadMessages.deleteMany);
const reactionDeleteMany = vi.mocked(prisma.reactions.deleteMany);
const pinDeleteMany = vi.mocked(prisma.pinnedMessages.deleteMany);
const attachmentDeleteMany = vi.mocked(prisma.attachment.deleteMany);
const deleteMedia = vi.mocked(deleteFilesFromCloudinary);

const memberChat = () => ({
  id: CHAT_ID,
  isGroupChat: false,
  adminId: null,
  avatarCloudinaryPublicId: null,
  ChatMembers: [{ userId: ACTOR_ID }],
});

const ownedMessage = ({
  id = MESSAGE_ID,
  attachments = [],
  audioPublicId = null,
}: {
  id?: string;
  attachments?: { cloudinaryPublicId: string }[];
  audioPublicId?: string | null;
} = {}) => ({
  id,
  chatId: CHAT_ID,
  senderId: ACTOR_ID,
  pollId: null,
  audioPublicId,
  attachments,
});

type EventHandler = (payload?: unknown) => Promise<void> | void;

const createHarness = async () => {
  const handlers = new Map<string, EventHandler>();
  let connectionHandler: ((socket: Socket) => Promise<void>) | undefined;
  const roomEmit = vi.fn();
  const ioTo = vi.fn((_room: string) => ({ emit: roomEmit }));
  const socket = {
    id: "socket-message-lifecycle",
    user: {
      id: ACTOR_ID,
      username: "lifecycle-actor",
      avatar: "lifecycle-avatar",
    },
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
    to: ioTo,
  };
  const limiter = new LocalSocketEventRateLimitAdapter();
  const limitSpy = vi.spyOn(limiter, "consumeAll").mockResolvedValue(true);
  const presence = {
    reconcileTransition: vi.fn(async () => undefined),
    reconcileUser: vi.fn(async () => undefined),
    reconcilePending: vi.fn(async () => 0),
    drain: vi.fn(async () => undefined),
  };

  registerSocketHandlers(io as unknown as Server, {
    registry: new SocketConnectionRegistry(),
    limiter,
    presence,
  });
  expect(connectionHandler).toBeDefined();
  await connectionHandler!(socket as unknown as Socket);
  vi.mocked(socket.emit).mockClear();

  return {
    ioTo,
    limitSpy,
    roomEmit,
    socket,
    trigger: async (event: Events, payload: unknown) => {
      const handler = handlers.get(event);
      expect(handler).toBeDefined();
      await handler!(payload);
    },
  };
};

const lifecycleCases = [
  {
    label: "MESSAGE_SEEN",
    event: Events.MESSAGE_SEEN,
    payload: { chatId: CHAT_ID },
    invalidPayload: { chatId: CHAT_ID, actorId: ACTOR_ID },
    actorPolicy: SOCKET_EVENT_LIMITS.seenActor,
    resourcePolicy: SOCKET_EVENT_LIMITS.seenChat,
    resourceKey: CHAT_ID,
    logContext: "Socket mark-as-seen failed.",
  },
  {
    label: "MESSAGE_EDIT",
    event: Events.MESSAGE_EDIT,
    payload: {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      updatedTextContent: "characterized edit",
    },
    invalidPayload: {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      updatedTextContent: "characterized edit",
      senderId: ACTOR_ID,
    },
    actorPolicy: SOCKET_EVENT_LIMITS.mutationActor,
    resourcePolicy: SOCKET_EVENT_LIMITS.editMessage,
    resourceKey: MESSAGE_ID,
    logContext: "Socket message edit failed.",
  },
  {
    label: "MESSAGE_DELETE",
    event: Events.MESSAGE_DELETE,
    payload: { chatId: CHAT_ID, messageId: MESSAGE_ID },
    invalidPayload: { chatId: CHAT_ID, messageId: MESSAGE_ID, senderId: ACTOR_ID },
    actorPolicy: SOCKET_EVENT_LIMITS.mutationActor,
    resourcePolicy: SOCKET_EVENT_LIMITS.deleteMessage,
    resourceKey: MESSAGE_ID,
    logContext: "Socket message deletion failed.",
  },
] as const;

const authorizationMockFor = (event: Events) => (
  event === Events.MESSAGE_SEEN ? chatFindFirst : messageFindFirst
);

const expectNoLifecycleMutation = () => {
  expect(unreadFindUnique).not.toHaveBeenCalled();
  expect(unreadUpdate).not.toHaveBeenCalled();
  expect(messageUpdate).not.toHaveBeenCalled();
  expect(messageUpdateMany).not.toHaveBeenCalled();
  expect(messageDelete).not.toHaveBeenCalled();
  expect(unreadDeleteMany).not.toHaveBeenCalled();
  expect(reactionDeleteMany).not.toHaveBeenCalled();
  expect(pinDeleteMany).not.toHaveBeenCalled();
  expect(attachmentDeleteMany).not.toHaveBeenCalled();
  expect(deleteMedia).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(prisma.user.update).mockResolvedValue({} as never);
  vi.mocked(prisma.chatMembers.findMany).mockResolvedValue([]);
  chatFindFirst.mockResolvedValue(memberChat() as never);
  messageFindFirst.mockResolvedValue(ownedMessage() as never);
  messageUpdate.mockResolvedValue({ textMessageContent: "characterized edit" } as never);
  messageUpdateMany.mockResolvedValue({ count: 1 } as never);
  messageDelete.mockResolvedValue({ id: MESSAGE_ID } as never);
  unreadFindUnique.mockResolvedValue(null);
  unreadUpdate.mockResolvedValue({ readAt: new Date("2026-01-01T00:00:01.000Z") } as never);
  unreadDeleteMany.mockResolvedValue({ count: 1 } as never);
  reactionDeleteMany.mockResolvedValue({ count: 1 } as never);
  pinDeleteMany.mockResolvedValue({ count: 1 } as never);
  attachmentDeleteMany.mockResolvedValue({ count: 1 } as never);
  deleteMedia.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Socket message lifecycle security ordering", () => {
  it.each(lifecycleCases)("parses $label before consuming a rate limit or doing work", async ({
    event,
    invalidPayload,
  }) => {
    const harness = await createHarness();

    await harness.trigger(event, invalidPayload);

    expect(harness.socket.emit).toHaveBeenCalledExactlyOnceWith(Events.SECURITY_ERROR, {
      category: "INVALID_PAYLOAD",
      event,
    });
    expect(harness.limitSpy).not.toHaveBeenCalled();
    expect(chatFindFirst).not.toHaveBeenCalled();
    expect(messageFindFirst).not.toHaveBeenCalled();
    expectNoLifecycleMutation();
    expect(harness.roomEmit).not.toHaveBeenCalled();
  });

  it.each(lifecycleCases)("applies the $label actor limit before authorization", async ({
    event,
    payload,
    actorPolicy,
  }) => {
    const harness = await createHarness();
    harness.limitSpy.mockResolvedValueOnce(false);

    await harness.trigger(event, payload);

    expect(harness.limitSpy).toHaveBeenCalledExactlyOnceWith([actorPolicy], [ACTOR_ID]);
    expect(authorizationMockFor(event)).not.toHaveBeenCalled();
    expectNoLifecycleMutation();
    expect(harness.roomEmit).not.toHaveBeenCalled();
    expect(harness.socket.emit).toHaveBeenCalledExactlyOnceWith(Events.SECURITY_ERROR, {
      category: "RATE_LIMITED",
      event,
    });
  });

  it.each(lifecycleCases)("does not consume the $label resource limit when authorization fails", async ({
    event,
    payload,
    actorPolicy,
    logContext,
  }) => {
    const authorizationFailure = new Error("private authorization detail");
    const authorizationMock = authorizationMockFor(event);
    authorizationMock.mockRejectedValueOnce(authorizationFailure as never);
    const harness = await createHarness();

    await harness.trigger(event, payload);

    expect(harness.limitSpy).toHaveBeenCalledExactlyOnceWith([actorPolicy], [ACTOR_ID]);
    expect(authorizationMock).toHaveBeenCalledTimes(1);
    expectNoLifecycleMutation();
    expect(harness.roomEmit).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith(logContext, { errorType: "Error" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private authorization detail");
  });

  it.each(lifecycleCases)("applies the $label resource limit after authorization and before mutation", async ({
    event,
    payload,
    actorPolicy,
    resourcePolicy,
    resourceKey,
  }) => {
    const harness = await createHarness();
    harness.limitSpy.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await harness.trigger(event, payload);

    const authorizationMock = authorizationMockFor(event);
    expect(harness.limitSpy).toHaveBeenNthCalledWith(1, [actorPolicy], [ACTOR_ID]);
    expect(harness.limitSpy).toHaveBeenNthCalledWith(2, [resourcePolicy], [ACTOR_ID, resourceKey]);
    expect(harness.limitSpy.mock.invocationCallOrder[0]).toBeLessThan(
      authorizationMock.mock.invocationCallOrder[0],
    );
    expect(authorizationMock.mock.invocationCallOrder[0]).toBeLessThan(
      harness.limitSpy.mock.invocationCallOrder[1],
    );
    expectNoLifecycleMutation();
    expect(harness.roomEmit).not.toHaveBeenCalled();
    expect(harness.socket.emit).toHaveBeenCalledExactlyOnceWith(Events.SECURITY_ERROR, {
      category: "RATE_LIMITED",
      event,
    });
  });
});

describe("MESSAGE_SEEN characterization", () => {
  it("updates the actor's unread row with the current time and emits the persisted read time", async () => {
    const writeTime = new Date("2026-02-03T04:05:06.000Z");
    const persistedReadTime = new Date("2026-02-03T04:05:07.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(writeTime);
    unreadFindUnique.mockResolvedValue({ id: UNREAD_ID } as never);
    unreadUpdate.mockResolvedValue({ readAt: persistedReadTime } as never);
    const harness = await createHarness();

    await harness.trigger(Events.MESSAGE_SEEN, { chatId: CHAT_ID });

    expect(harness.limitSpy).toHaveBeenNthCalledWith(
      1,
      [SOCKET_EVENT_LIMITS.seenActor],
      [ACTOR_ID],
    );
    expect(harness.limitSpy).toHaveBeenNthCalledWith(
      2,
      [SOCKET_EVENT_LIMITS.seenChat],
      [ACTOR_ID, CHAT_ID],
    );
    expect(harness.limitSpy.mock.invocationCallOrder[0]).toBeLessThan(
      chatFindFirst.mock.invocationCallOrder[0],
    );
    expect(chatFindFirst.mock.invocationCallOrder[0]).toBeLessThan(
      harness.limitSpy.mock.invocationCallOrder[1],
    );
    expect(harness.limitSpy.mock.invocationCallOrder[1]).toBeLessThan(
      unreadFindUnique.mock.invocationCallOrder[0],
    );
    expect(unreadFindUnique).toHaveBeenCalledExactlyOnceWith({
      where: { userId_chatId: { userId: ACTOR_ID, chatId: CHAT_ID } },
    });
    expect(unreadUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: UNREAD_ID },
      data: { count: 0, readAt: writeTime },
    });
    expect(unreadFindUnique.mock.invocationCallOrder[0]).toBeLessThan(
      unreadUpdate.mock.invocationCallOrder[0],
    );
    expect(harness.ioTo).toHaveBeenCalledExactlyOnceWith(CHAT_ID);
    expect(harness.roomEmit).toHaveBeenCalledExactlyOnceWith(Events.MESSAGE_SEEN, {
      user: {
        id: ACTOR_ID,
        username: "lifecycle-actor",
        avatar: "lifecycle-avatar",
      },
      chatId: CHAT_ID,
      readAt: persistedReadTime,
    });
    expect(unreadUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      harness.roomEmit.mock.invocationCallOrder[0],
    );
  });

  it("returns without an update or event when the actor has no unread row", async () => {
    unreadFindUnique.mockResolvedValue(null);
    const harness = await createHarness();

    await harness.trigger(Events.MESSAGE_SEEN, { chatId: CHAT_ID });

    expect(harness.limitSpy).toHaveBeenCalledTimes(2);
    expect(unreadFindUnique).toHaveBeenCalledExactlyOnceWith({
      where: { userId_chatId: { userId: ACTOR_ID, chatId: CHAT_ID } },
    });
    expect(unreadUpdate).not.toHaveBeenCalled();
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(harness.roomEmit).not.toHaveBeenCalled();
  });

  it("safe-logs an unread update failure and emits nothing", async () => {
    unreadFindUnique.mockResolvedValue({ id: UNREAD_ID } as never);
    unreadUpdate.mockRejectedValue(new Error("private unread failure"));
    const harness = await createHarness();

    await harness.trigger(Events.MESSAGE_SEEN, { chatId: CHAT_ID });

    expect(harness.roomEmit).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "Socket mark-as-seen failed.",
      { errorType: "Error" },
    );
  });

  it("keeps the persisted seen update when delivery throws and reaches the event-local safe log", async () => {
    const persistedReadTime = new Date("2026-02-03T04:05:07.000Z");
    const deliveryError = new Error("private seen delivery failure");
    unreadFindUnique.mockResolvedValue({ id: UNREAD_ID } as never);
    unreadUpdate.mockResolvedValue({ readAt: persistedReadTime } as never);
    const harness = await createHarness();
    harness.roomEmit.mockImplementation(() => {
      throw deliveryError;
    });

    await harness.trigger(Events.MESSAGE_SEEN, { chatId: CHAT_ID });

    expect(unreadUpdate).toHaveBeenCalledOnce();
    expect(harness.ioTo).toHaveBeenCalledExactlyOnceWith(CHAT_ID);
    expect(harness.roomEmit).toHaveBeenCalledExactlyOnceWith(Events.MESSAGE_SEEN, {
      user: {
        id: ACTOR_ID,
        username: "lifecycle-actor",
        avatar: "lifecycle-avatar",
      },
      chatId: CHAT_ID,
      readAt: persistedReadTime,
    });
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "Socket mark-as-seen failed.",
      { errorType: "Error" },
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "private seen delivery failure",
    );
  });
});

describe("MESSAGE_EDIT characterization", () => {
  it("keys the resource limit and write by the authorized ID, then emits the persisted text", async () => {
    messageFindFirst.mockResolvedValue(ownedMessage({ id: AUTHORIZED_MESSAGE_ID }) as never);
    messageUpdate.mockResolvedValue({ textMessageContent: "persisted edit" } as never);
    const harness = await createHarness();

    await harness.trigger(Events.MESSAGE_EDIT, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      updatedTextContent: "requested edit",
    });

    expect(harness.limitSpy).toHaveBeenNthCalledWith(
      1,
      [SOCKET_EVENT_LIMITS.mutationActor],
      [ACTOR_ID],
    );
    expect(harness.limitSpy).toHaveBeenNthCalledWith(
      2,
      [SOCKET_EVENT_LIMITS.editMessage],
      [ACTOR_ID, AUTHORIZED_MESSAGE_ID],
    );
    expect(harness.limitSpy.mock.invocationCallOrder[0]).toBeLessThan(
      messageFindFirst.mock.invocationCallOrder[0],
    );
    expect(messageFindFirst.mock.invocationCallOrder[0]).toBeLessThan(
      harness.limitSpy.mock.invocationCallOrder[1],
    );
    expect(harness.limitSpy.mock.invocationCallOrder[1]).toBeLessThan(
      messageUpdate.mock.invocationCallOrder[0],
    );
    expect(messageUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: AUTHORIZED_MESSAGE_ID },
      data: { textMessageContent: "requested edit", isEdited: true },
    });
    expect(harness.ioTo).toHaveBeenCalledExactlyOnceWith(CHAT_ID);
    expect(harness.roomEmit).toHaveBeenCalledExactlyOnceWith(Events.MESSAGE_EDIT, {
      updatedTextMessageContent: "persisted edit",
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
    });
    expect(messageUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      harness.roomEmit.mock.invocationCallOrder[0],
    );
  });

  it("safe-logs a persistence failure and emits nothing", async () => {
    messageUpdate.mockRejectedValue(new Error("private edit failure"));
    const harness = await createHarness();

    await harness.trigger(Events.MESSAGE_EDIT, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      updatedTextContent: "requested edit",
    });

    expect(harness.roomEmit).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "Socket message edit failed.",
      { errorType: "Error" },
    );
  });

  it("keeps the persisted edit when delivery throws and reaches the event-local safe log", async () => {
    const deliveryError = new Error("private edit delivery failure");
    messageUpdate.mockResolvedValue({ textMessageContent: "persisted edit" } as never);
    const harness = await createHarness();
    harness.roomEmit.mockImplementation(() => {
      throw deliveryError;
    });

    await harness.trigger(Events.MESSAGE_EDIT, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      updatedTextContent: "requested edit",
    });

    expect(messageUpdate).toHaveBeenCalledOnce();
    expect(harness.ioTo).toHaveBeenCalledExactlyOnceWith(CHAT_ID);
    expect(harness.roomEmit).toHaveBeenCalledExactlyOnceWith(Events.MESSAGE_EDIT, {
      updatedTextMessageContent: "persisted edit",
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
    });
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "Socket message edit failed.",
      { errorType: "Error" },
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "private edit delivery failure",
    );
  });
});

const DELETE_STEPS = [
  "pinned rows",
  "reply detach",
  "unread rows",
  "reaction rows",
  "attachment rows",
  "attachment media",
  "audio media",
  "message row",
] as const;

type DeleteStep = typeof DELETE_STEPS[number];

const configureDeleteTrace = (
  trace: DeleteStep[],
  failAt?: DeleteStep,
) => {
  const failure = new Error(`private ${failAt ?? "delete"} failure`);
  const record = <Result>(step: DeleteStep, result: Result): Result => {
    trace.push(step);
    if (step === failAt) throw failure;
    return result;
  };

  pinDeleteMany.mockImplementation(async () => record("pinned rows", { count: 1 }) as never);
  messageUpdateMany.mockImplementation(async () => record("reply detach", { count: 1 }) as never);
  unreadDeleteMany.mockImplementation(async () => record("unread rows", { count: 1 }) as never);
  reactionDeleteMany.mockImplementation(async () => record("reaction rows", { count: 1 }) as never);
  attachmentDeleteMany.mockImplementation(async () => record("attachment rows", { count: 2 }) as never);
  deleteMedia.mockImplementation(async ({ resourceType }) => {
    record(resourceType === "raw" ? "audio media" : "attachment media", undefined);
  });
  messageDelete.mockImplementation(async () => record("message row", { id: DELETED_MESSAGE_ID }) as never);
};

describe("MESSAGE_DELETE destructive lifecycle characterization", () => {
  it("preserves the exact non-transactional DB/media order, arguments, and payload", async () => {
    messageFindFirst.mockResolvedValue(ownedMessage({
      id: AUTHORIZED_MESSAGE_ID,
      attachments: [
        { cloudinaryPublicId: "attachment-public-id-1" },
        { cloudinaryPublicId: "attachment-public-id-2" },
      ],
      audioPublicId: "audio-public-id",
    }) as never);
    messageDelete.mockResolvedValue({ id: DELETED_MESSAGE_ID } as never);
    const harness = await createHarness();

    await harness.trigger(Events.MESSAGE_DELETE, { chatId: CHAT_ID, messageId: MESSAGE_ID });

    expect(harness.limitSpy).toHaveBeenNthCalledWith(
      1,
      [SOCKET_EVENT_LIMITS.mutationActor],
      [ACTOR_ID],
    );
    expect(harness.limitSpy).toHaveBeenNthCalledWith(
      2,
      [SOCKET_EVENT_LIMITS.deleteMessage],
      [ACTOR_ID, AUTHORIZED_MESSAGE_ID],
    );
    expect(pinDeleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { messageId: AUTHORIZED_MESSAGE_ID },
    });
    expect(messageUpdateMany).toHaveBeenCalledExactlyOnceWith({
      where: { replyToMessageId: AUTHORIZED_MESSAGE_ID },
      data: { replyToMessageId: null },
    });
    expect(unreadDeleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { messageId: AUTHORIZED_MESSAGE_ID },
    });
    expect(reactionDeleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { messageId: AUTHORIZED_MESSAGE_ID },
    });
    expect(attachmentDeleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { messageId: AUTHORIZED_MESSAGE_ID },
    });
    expect(deleteMedia).toHaveBeenNthCalledWith(1, {
      publicIds: ["attachment-public-id-1", "attachment-public-id-2"],
    });
    expect(deleteMedia).toHaveBeenNthCalledWith(2, {
      publicIds: ["audio-public-id"],
      resourceType: "raw",
    });
    expect(messageDelete).toHaveBeenCalledExactlyOnceWith({
      where: { id: AUTHORIZED_MESSAGE_ID },
      select: { id: true },
    });

    const order = [
      messageFindFirst.mock.invocationCallOrder[0],
      harness.limitSpy.mock.invocationCallOrder[1],
      pinDeleteMany.mock.invocationCallOrder[0],
      messageUpdateMany.mock.invocationCallOrder[0],
      unreadDeleteMany.mock.invocationCallOrder[0],
      reactionDeleteMany.mock.invocationCallOrder[0],
      attachmentDeleteMany.mock.invocationCallOrder[0],
      deleteMedia.mock.invocationCallOrder[0],
      deleteMedia.mock.invocationCallOrder[1],
      messageDelete.mock.invocationCallOrder[0],
      harness.roomEmit.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(harness.ioTo).toHaveBeenCalledExactlyOnceWith(CHAT_ID);
    expect(harness.roomEmit).toHaveBeenCalledExactlyOnceWith(Events.MESSAGE_DELETE, {
      messageId: DELETED_MESSAGE_ID,
      chatId: CHAT_ID,
    });
  });

  it("skips attachment and provider deletion when the authorized message has no media", async () => {
    messageFindFirst.mockResolvedValue(ownedMessage() as never);
    const harness = await createHarness();

    await harness.trigger(Events.MESSAGE_DELETE, { chatId: CHAT_ID, messageId: MESSAGE_ID });

    expect(pinDeleteMany).toHaveBeenCalledTimes(1);
    expect(messageUpdateMany).toHaveBeenCalledTimes(1);
    expect(unreadDeleteMany).toHaveBeenCalledTimes(1);
    expect(reactionDeleteMany).toHaveBeenCalledTimes(1);
    expect(attachmentDeleteMany).not.toHaveBeenCalled();
    expect(deleteMedia).not.toHaveBeenCalled();
    expect(messageDelete).toHaveBeenCalledTimes(1);
    expect(harness.roomEmit).toHaveBeenCalledTimes(1);
  });

  it("does not emit when message.delete returns a falsy ID", async () => {
    messageDelete.mockResolvedValue({ id: "" } as never);
    const harness = await createHarness();

    await harness.trigger(Events.MESSAGE_DELETE, { chatId: CHAT_ID, messageId: MESSAGE_ID });

    expect(messageDelete).toHaveBeenCalledTimes(1);
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(harness.roomEmit).not.toHaveBeenCalled();
  });

  it("keeps all destructive work when delivery throws and reaches the event-local safe log", async () => {
    const deliveryError = new Error("private delete delivery failure");
    messageFindFirst.mockResolvedValue(ownedMessage({
      attachments: [{ cloudinaryPublicId: "attachment-public-id" }],
      audioPublicId: "audio-public-id",
    }) as never);
    messageDelete.mockResolvedValue({ id: DELETED_MESSAGE_ID } as never);
    const harness = await createHarness();
    harness.roomEmit.mockImplementation(() => {
      throw deliveryError;
    });

    await harness.trigger(Events.MESSAGE_DELETE, { chatId: CHAT_ID, messageId: MESSAGE_ID });

    expect(pinDeleteMany).toHaveBeenCalledOnce();
    expect(messageUpdateMany).toHaveBeenCalledOnce();
    expect(unreadDeleteMany).toHaveBeenCalledOnce();
    expect(reactionDeleteMany).toHaveBeenCalledOnce();
    expect(attachmentDeleteMany).toHaveBeenCalledOnce();
    expect(deleteMedia).toHaveBeenCalledTimes(2);
    expect(messageDelete).toHaveBeenCalledOnce();
    expect(harness.ioTo).toHaveBeenCalledExactlyOnceWith(CHAT_ID);
    expect(harness.roomEmit).toHaveBeenCalledExactlyOnceWith(Events.MESSAGE_DELETE, {
      messageId: DELETED_MESSAGE_ID,
      chatId: CHAT_ID,
    });
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "Socket message deletion failed.",
      { errorType: "Error" },
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "private delete delivery failure",
    );
  });

  it.each(DELETE_STEPS)("stops after the destructive %s step rejects", async (failAt) => {
    const trace: DeleteStep[] = [];
    messageFindFirst.mockResolvedValue(ownedMessage({
      attachments: [
        { cloudinaryPublicId: "attachment-public-id-1" },
        { cloudinaryPublicId: "attachment-public-id-2" },
      ],
      audioPublicId: "audio-public-id",
    }) as never);
    configureDeleteTrace(trace, failAt);
    const harness = await createHarness();

    await harness.trigger(Events.MESSAGE_DELETE, { chatId: CHAT_ID, messageId: MESSAGE_ID });

    const failedIndex = DELETE_STEPS.indexOf(failAt);
    expect(trace).toEqual(DELETE_STEPS.slice(0, failedIndex + 1));
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(harness.roomEmit).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "Socket message deletion failed.",
      { errorType: "Error" },
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(`private ${failAt} failure`);
  });
});
