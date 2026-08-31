import type { Server, Socket } from "socket.io";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
    vote: {
      findFirst: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
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

vi.mock("../src/modules/notifications/push-notification.service.js", () => ({
  sendPushNotification: vi.fn(),
}));

vi.mock("../src/socket/webrtc/socket.js", () => ({
  default: vi.fn(),
}));

import { Events } from "../src/enums/event/event.enum.js";
import { prisma } from "../src/lib/prisma.lib.js";
import { SocketConnectionRegistry } from "../src/socket/connection-registry.js";
import { LocalSocketEventRateLimitAdapter } from "../src/socket/local-socket-event-rate-limit.adapter.js";
import registerSocketHandlers from "../src/socket/socket.js";
import {
  deleteFilesFromCloudinary,
  uploadAudioToCloudinary,
  uploadEncryptedAudioToCloudinary,
} from "../src/utils/auth.util.js";
import { sendPushNotification } from "../src/modules/notifications/push-notification.service.js";

const ACTOR_ID = "cm00000000000000000000001";
const CHAT_ID = "cm00000000000000000000002";
const MESSAGE_ID = "cm00000000000000000000003";
const PIN_ID = "cm00000000000000000000004";
const OTHER_MESSAGE_ID = "cm00000000000000000000005";
const OTHER_PIN_ID = "cm00000000000000000000006";

const chatFindFirst = vi.mocked(prisma.chat.findFirst);
const chatUpdate = vi.mocked(prisma.chat.update);
const messageFindFirst = vi.mocked(prisma.message.findFirst);
const messageFindUnique = vi.mocked(prisma.message.findUnique);
const messageCreate = vi.mocked(prisma.message.create);
const messageUpdate = vi.mocked(prisma.message.update);
const messageUpdateMany = vi.mocked(prisma.message.updateMany);
const messageDelete = vi.mocked(prisma.message.delete);
const pollCreate = vi.mocked(prisma.poll.create);
const unreadFindUnique = vi.mocked(prisma.unreadMessages.findUnique);
const unreadCreate = vi.mocked(prisma.unreadMessages.create);
const unreadUpdate = vi.mocked(prisma.unreadMessages.update);
const unreadDeleteMany = vi.mocked(prisma.unreadMessages.deleteMany);
const reactionFindFirst = vi.mocked(prisma.reactions.findFirst);
const reactionCreate = vi.mocked(prisma.reactions.create);
const reactionDeleteMany = vi.mocked(prisma.reactions.deleteMany);
const voteFindFirst = vi.mocked(prisma.vote.findFirst);
const voteCreate = vi.mocked(prisma.vote.create);
const voteDeleteMany = vi.mocked(prisma.vote.deleteMany);
const pinFindFirst = vi.mocked(prisma.pinnedMessages.findFirst);
const pinFindMany = vi.mocked(prisma.pinnedMessages.findMany);
const pinCreate = vi.mocked(prisma.pinnedMessages.create);
const pinDelete = vi.mocked(prisma.pinnedMessages.delete);
const pinDeleteMany = vi.mocked(prisma.pinnedMessages.deleteMany);
const attachmentDeleteMany = vi.mocked(prisma.attachment.deleteMany);
const deleteFromCloudinary = vi.mocked(deleteFilesFromCloudinary);
const uploadAudio = vi.mocked(uploadAudioToCloudinary);
const uploadEncryptedAudio = vi.mocked(uploadEncryptedAudioToCloudinary);
const pushNotification = vi.mocked(sendPushNotification);

const memberChat = () => ({
  id: CHAT_ID,
  isGroupChat: true,
  adminId: "group-admin",
  avatarCloudinaryPublicId: null,
  ChatMembers: [{ userId: ACTOR_ID }],
});

const accessibleMessage = ({
  senderId = ACTOR_ID,
  pollId = null,
  audioPublicId = null,
  attachments = [],
}: {
  senderId?: string;
  pollId?: string | null;
  audioPublicId?: string | null;
  attachments?: { cloudinaryPublicId: string }[];
} = {}) => ({
  id: MESSAGE_ID,
  chatId: CHAT_ID,
  senderId,
  pollId,
  audioPublicId,
  attachments,
});

type EventHandler = (payload: Record<string, unknown>) => Promise<void> | void;

const connectSocket = async () => {
  const handlers = new Map<string, EventHandler>();
  const roomEmit = vi.fn();
  const broadcastRoomEmit = vi.fn();
  let connectionHandler: ((socket: Socket) => Promise<void>) | undefined;

  const socket = {
    id: "socket-1",
    user: {
      id: ACTOR_ID,
      username: "actor",
      avatar: "actor-avatar",
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
      to: vi.fn(() => ({ emit: broadcastRoomEmit })),
    },
  };

  const io = {
    on: vi.fn((event: string, handler: (socket: Socket) => Promise<void>) => {
      expect(event).toBe("connection");
      connectionHandler = handler;
      return io;
    }),
    to: vi.fn(() => ({ emit: roomEmit })),
  };

  registerSocketHandlers(io as unknown as Server, {
    registry: new SocketConnectionRegistry(),
    limiter: new LocalSocketEventRateLimitAdapter(),
  });
  expect(connectionHandler).toBeDefined();
  await connectionHandler!(socket as unknown as Socket);

  return {
    broadcastRoomEmit,
    roomEmit,
    socket,
    trigger: async (event: Events, payload: Record<string, unknown>) => {
      const handler = handlers.get(event);
      expect(handler).toBeDefined();
      await handler!(payload);
    },
  };
};

const mutationMocks = [
  chatUpdate,
  messageCreate,
  messageUpdate,
  messageUpdateMany,
  messageDelete,
  pollCreate,
  unreadCreate,
  unreadUpdate,
  unreadDeleteMany,
  reactionCreate,
  reactionDeleteMany,
  voteCreate,
  voteDeleteMany,
  pinCreate,
  pinDelete,
  pinDeleteMany,
  attachmentDeleteMany,
];

const expectNoMutationOrTrustedEmit = (
  roomEmit: ReturnType<typeof vi.fn>,
  broadcastRoomEmit: ReturnType<typeof vi.fn>,
) => {
  for (const mutation of mutationMocks) {
    expect(mutation).not.toHaveBeenCalled();
  }
  expect(deleteFromCloudinary).not.toHaveBeenCalled();
  expect(uploadAudio).not.toHaveBeenCalled();
  expect(uploadEncryptedAudio).not.toHaveBeenCalled();
  expect(roomEmit).not.toHaveBeenCalled();
  expect(broadcastRoomEmit).not.toHaveBeenCalled();
};

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.update).mockResolvedValue({} as never);
  vi.mocked(prisma.chatMembers.findMany).mockResolvedValue([]);
});

describe("Socket chat/message authorization failures", () => {
  it.each([
    ["MESSAGE", Events.MESSAGE, { chatId: CHAT_ID, isPollMessage: false, textMessageContent: "hello" }],
    ["MESSAGE_SEEN", Events.MESSAGE_SEEN, { chatId: CHAT_ID }],
    ["MESSAGE_EDIT", Events.MESSAGE_EDIT, { chatId: CHAT_ID, messageId: MESSAGE_ID, updatedTextContent: "edit" }],
    ["MESSAGE_DELETE", Events.MESSAGE_DELETE, { chatId: CHAT_ID, messageId: MESSAGE_ID }],
    ["NEW_REACTION", Events.NEW_REACTION, { chatId: CHAT_ID, messageId: MESSAGE_ID, reaction: "like" }],
    ["DELETE_REACTION", Events.DELETE_REACTION, { chatId: CHAT_ID, messageId: MESSAGE_ID }],
    ["USER_TYPING", Events.USER_TYPING, { chatId: CHAT_ID }],
    ["VOTE_IN", Events.VOTE_IN, { chatId: CHAT_ID, messageId: MESSAGE_ID, optionIndex: 0 }],
    ["VOTE_OUT", Events.VOTE_OUT, { chatId: CHAT_ID, messageId: MESSAGE_ID, optionIndex: 0 }],
    ["PIN_MESSAGE", Events.PIN_MESSAGE, { chatId: CHAT_ID, messageId: MESSAGE_ID }],
    ["UNPIN_MESSAGE", Events.UNPIN_MESSAGE, { pinId: PIN_ID }],
  ])("nonmember cannot %s", async (_label, event, payload) => {
    chatFindFirst.mockResolvedValue(null);
    messageFindFirst.mockResolvedValue(null);
    pinFindFirst.mockResolvedValue(null);
    const harness = await connectSocket();

    await harness.trigger(event, payload);

    expectNoMutationOrTrustedEmit(harness.roomEmit, harness.broadcastRoomEmit);
    expect(harness.socket.disconnect).not.toHaveBeenCalled();
  });

  it("member cannot edit another user's message", async () => {
    messageFindFirst.mockResolvedValue(accessibleMessage({ senderId: "other-user" }) as never);
    const harness = await connectSocket();

    await harness.trigger(Events.MESSAGE_EDIT, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      updatedTextContent: "unauthorized edit",
    });

    expect(messageUpdate).not.toHaveBeenCalled();
    expect(harness.roomEmit).not.toHaveBeenCalled();
  });

  it("member cannot delete another user's message and no destructive step runs", async () => {
    messageFindFirst.mockResolvedValue(accessibleMessage({ senderId: "other-user" }) as never);
    const harness = await connectSocket();

    await harness.trigger(Events.MESSAGE_DELETE, { chatId: CHAT_ID, messageId: MESSAGE_ID });

    expectNoMutationOrTrustedEmit(harness.roomEmit, harness.broadcastRoomEmit);
  });

  it("rejects a reply ID bound to another chat before upload or creation", async () => {
    chatFindFirst.mockResolvedValue(memberChat() as never);
    messageFindFirst.mockResolvedValue(null);
    const harness = await connectSocket();

    await harness.trigger(Events.MESSAGE, {
      chatId: CHAT_ID,
      isPollMessage: false,
      audio: new Uint8Array([1, 2, 3]),
      audioMimeType: "audio/webm",
      replyToMessageId: OTHER_MESSAGE_ID,
    });

    expect(messageFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ chatId: CHAT_ID, id: OTHER_MESSAGE_ID }),
    }));
    expectNoMutationOrTrustedEmit(harness.roomEmit, harness.broadcastRoomEmit);
  });

  it.each([Events.MESSAGE_EDIT, Events.MESSAGE_DELETE])("rejects cross-chat %s", async (event) => {
    messageFindFirst.mockResolvedValue(null);
    const harness = await connectSocket();

    await harness.trigger(event, {
      chatId: CHAT_ID,
      messageId: OTHER_MESSAGE_ID,
      ...(event === Events.MESSAGE_EDIT ? { updatedTextContent: "edit" } : {}),
    });

    expect(messageFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ chatId: CHAT_ID, id: OTHER_MESSAGE_ID }),
    }));
    expectNoMutationOrTrustedEmit(harness.roomEmit, harness.broadcastRoomEmit);
  });

  it("rejects an arbitrary pin ID from another chat before deletion", async () => {
    pinFindFirst.mockResolvedValue(null);
    const harness = await connectSocket();

    await harness.trigger(Events.UNPIN_MESSAGE, { pinId: OTHER_PIN_ID });

    expect(pinFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: OTHER_PIN_ID,
        chat: { ChatMembers: { some: { userId: ACTOR_ID } } },
      }),
    }));
    expect(pinDelete).not.toHaveBeenCalled();
    expect(harness.roomEmit).not.toHaveBeenCalled();
  });
});

describe("Socket chat/message authorized operations", () => {
  it("allows a member to send after authorization and derives the sender from socket identity", async () => {
    chatFindFirst.mockResolvedValue(memberChat() as never);
    uploadAudio.mockResolvedValue({
      public_id: "audio-public-id",
      secure_url: "https://example.test/audio",
    } as never);
    messageCreate.mockResolvedValue({
      id: MESSAGE_ID,
      isTextMessage: false,
      isPollMessage: false,
      audioPublicId: "audio-public-id",
      createdAt: new Date(),
    } as never);
    chatUpdate.mockResolvedValue({ ChatMembers: [] } as never);
    messageFindUnique.mockResolvedValue({ id: MESSAGE_ID } as never);
    const harness = await connectSocket();

    await harness.trigger(Events.MESSAGE, {
      chatId: CHAT_ID,
      isPollMessage: false,
      audio: new Uint8Array([1, 2, 3]),
      audioMimeType: "audio/webm",
    });

    expect(chatFindFirst.mock.invocationCallOrder[0]).toBeLessThan(uploadAudio.mock.invocationCallOrder[0]);
    expect(uploadAudio.mock.invocationCallOrder[0]).toBeLessThan(messageCreate.mock.invocationCallOrder[0]);
    expect(messageCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ chatId: CHAT_ID, senderId: ACTOR_ID }),
    }));
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.MESSAGE, expect.objectContaining({ id: MESSAGE_ID }));
  });

  it("destroys a newly uploaded audio asset when message persistence fails", async () => {
    chatFindFirst.mockResolvedValue(memberChat() as never);
    uploadAudio.mockResolvedValue({
      public_id: "orphan-audio-id",
      secure_url: "https://example.test/audio",
    } as never);
    messageCreate.mockRejectedValue(new Error("database failure"));
    const harness = await connectSocket();

    await harness.trigger(Events.MESSAGE, {
      chatId: CHAT_ID,
      isPollMessage: false,
      audio: new Uint8Array([1, 2, 3]),
      audioMimeType: "audio/webm",
    });

    expect(deleteFromCloudinary).toHaveBeenCalledWith({
      publicIds: ["orphan-audio-id"],
      resourceType: "raw",
    });
    expect(harness.roomEmit).not.toHaveBeenCalledWith(Events.MESSAGE, expect.anything());
  });

  it("sends an offline chat member the expected notification", async () => {
    chatFindFirst.mockResolvedValue(memberChat() as never);
    messageCreate.mockResolvedValue({
      id: MESSAGE_ID,
      isTextMessage: true,
      isPollMessage: false,
      textMessageContent: "hello",
      createdAt: new Date(),
    } as never);
    chatUpdate.mockResolvedValue({
      ChatMembers: [{
        user: {
          id: "offline-member",
          isOnline: false,
          notificationsEnabled: true,
          fcmToken: "offline-token",
        },
      }],
    } as never);
    messageFindUnique.mockResolvedValue({ id: MESSAGE_ID } as never);
    unreadFindUnique.mockResolvedValue(null);
    unreadCreate.mockResolvedValue({ id: "unread-1" } as never);
    const harness = await connectSocket();

    await harness.trigger(Events.MESSAGE, {
      chatId: CHAT_ID,
      isPollMessage: false,
      textMessageContent: "hello",
    });

    expect(pushNotification).toHaveBeenCalledWith({
      recipientToken: "offline-token",
      body: "New message from actor",
    });
  });

  it.each([
    ["notifications are disabled", false, "offline-token"],
    ["the token is missing", true, null],
  ])("does not send when %s", async (_label, notificationsEnabled, fcmToken) => {
    chatFindFirst.mockResolvedValue(memberChat() as never);
    messageCreate.mockResolvedValue({
      id: MESSAGE_ID,
      isTextMessage: true,
      isPollMessage: false,
      textMessageContent: "hello",
      createdAt: new Date(),
    } as never);
    chatUpdate.mockResolvedValue({
      ChatMembers: [{
        user: {
          id: "offline-member",
          isOnline: false,
          notificationsEnabled,
          fcmToken,
        },
      }],
    } as never);
    messageFindUnique.mockResolvedValue({ id: MESSAGE_ID } as never);
    unreadFindUnique.mockResolvedValue(null);
    unreadCreate.mockResolvedValue({ id: "unread-1" } as never);
    const harness = await connectSocket();

    await harness.trigger(Events.MESSAGE, {
      chatId: CHAT_ID,
      isPollMessage: false,
      textMessageContent: "hello",
    });

    expect(pushNotification).not.toHaveBeenCalled();
  });

  it("marks only the member's own unread record as seen", async () => {
    chatFindFirst.mockResolvedValue(memberChat() as never);
    unreadFindUnique.mockResolvedValue({ id: "unread-1" } as never);
    unreadUpdate.mockResolvedValue({ readAt: new Date() } as never);
    const harness = await connectSocket();

    await harness.trigger(Events.MESSAGE_SEEN, { chatId: CHAT_ID });

    expect(unreadFindUnique).toHaveBeenCalledWith({
      where: { userId_chatId: { userId: ACTOR_ID, chatId: CHAT_ID } },
    });
    expect(unreadUpdate).toHaveBeenCalledTimes(1);
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.MESSAGE_SEEN, expect.any(Object));
  });

  it("allows an owner to edit their own message after the ownership query", async () => {
    messageFindFirst.mockResolvedValue(accessibleMessage() as never);
    messageUpdate.mockResolvedValue({ textMessageContent: "edited" } as never);
    const harness = await connectSocket();

    await harness.trigger(Events.MESSAGE_EDIT, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      updatedTextContent: "edited",
    });

    expect(messageFindFirst.mock.invocationCallOrder[0]).toBeLessThan(messageUpdate.mock.invocationCallOrder[0]);
    expect(messageUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: MESSAGE_ID } }));
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.MESSAGE_EDIT, expect.any(Object));
  });

  it("allows an owner to delete only after ownership, including Cloudinary ordering", async () => {
    messageFindFirst.mockResolvedValue(accessibleMessage({
      audioPublicId: "audio-public-id",
      attachments: [{ cloudinaryPublicId: "attachment-public-id" }],
    }) as never);
    messageDelete.mockResolvedValue({ id: MESSAGE_ID } as never);
    deleteFromCloudinary.mockResolvedValue(undefined);
    const harness = await connectSocket();

    await harness.trigger(Events.MESSAGE_DELETE, { chatId: CHAT_ID, messageId: MESSAGE_ID });

    expect(messageFindFirst.mock.invocationCallOrder[0]).toBeLessThan(pinDeleteMany.mock.invocationCallOrder[0]);
    expect(messageFindFirst.mock.invocationCallOrder[0]).toBeLessThan(attachmentDeleteMany.mock.invocationCallOrder[0]);
    expect(messageFindFirst.mock.invocationCallOrder[0]).toBeLessThan(deleteFromCloudinary.mock.invocationCallOrder[0]);
    expect(deleteFromCloudinary.mock.invocationCallOrder[0]).toBeLessThan(messageDelete.mock.invocationCallOrder[0]);
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.MESSAGE_DELETE, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
    });
  });

  it("allows a member to react and remove only their own reaction", async () => {
    messageFindFirst.mockResolvedValue(accessibleMessage() as never);
    reactionFindFirst.mockResolvedValue(null);
    const harness = await connectSocket();

    await harness.trigger(Events.NEW_REACTION, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      reaction: "like",
    });
    await harness.trigger(Events.DELETE_REACTION, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
    });

    expect(reactionCreate).toHaveBeenCalledWith({
      data: { reaction: "like", userId: ACTOR_ID, messageId: MESSAGE_ID },
    });
    expect(reactionDeleteMany).toHaveBeenCalledWith({
      where: { userId: ACTOR_ID, messageId: MESSAGE_ID },
    });
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.NEW_REACTION, expect.any(Object));
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.DELETE_REACTION, expect.any(Object));
  });

  it("allows a member to vote and remove only their own vote", async () => {
    messageFindFirst.mockResolvedValue(accessibleMessage({ pollId: "poll-1" }) as never);
    voteFindFirst.mockResolvedValue({ id: "vote-1" } as never);
    const harness = await connectSocket();

    await harness.trigger(Events.VOTE_IN, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      optionIndex: 1,
    });
    await harness.trigger(Events.VOTE_OUT, {
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      optionIndex: 1,
    });

    expect(voteCreate).toHaveBeenCalledWith({
      data: { pollId: "poll-1", userId: ACTOR_ID, optionIndex: 1 },
    });
    expect(voteDeleteMany).toHaveBeenCalledWith({
      where: { userId: ACTOR_ID, pollId: "poll-1", optionIndex: 1 },
    });
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.VOTE_IN, expect.any(Object));
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.VOTE_OUT, expect.any(Object));
  });

  it("allows a member to pin and unpin a message", async () => {
    messageFindFirst.mockResolvedValue(accessibleMessage() as never);
    pinFindMany.mockResolvedValue([]);
    pinCreate.mockResolvedValue({ id: PIN_ID } as never);
    pinFindFirst.mockResolvedValue({ id: PIN_ID, chatId: CHAT_ID, messageId: MESSAGE_ID } as never);
    pinDelete.mockResolvedValue({ id: PIN_ID, chatId: CHAT_ID, messageId: MESSAGE_ID } as never);
    const harness = await connectSocket();

    await harness.trigger(Events.PIN_MESSAGE, { chatId: CHAT_ID, messageId: MESSAGE_ID });
    await harness.trigger(Events.UNPIN_MESSAGE, { pinId: PIN_ID });

    expect(pinCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: { chatId: CHAT_ID, messageId: MESSAGE_ID },
    }));
    expect(pinFindFirst.mock.invocationCallOrder[0]).toBeLessThan(pinDelete.mock.invocationCallOrder[0]);
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.PIN_MESSAGE, expect.any(Object));
    expect(harness.roomEmit).toHaveBeenCalledWith(Events.UNPIN_MESSAGE, expect.any(Object));
  });

  it("allows a current member to emit typing activity", async () => {
    chatFindFirst.mockResolvedValue(memberChat() as never);
    const harness = await connectSocket();

    await harness.trigger(Events.USER_TYPING, { chatId: CHAT_ID });

    expect(harness.broadcastRoomEmit).toHaveBeenCalledWith(Events.USER_TYPING, expect.objectContaining({
      chatId: CHAT_ID,
      user: expect.objectContaining({ id: ACTOR_ID }),
    }));
  });
});
