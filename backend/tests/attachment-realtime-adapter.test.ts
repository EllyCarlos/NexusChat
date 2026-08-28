import type { Server } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/socket.util.js", () => ({
  emitEventToRoom: vi.fn(),
}));

import { Events } from "../src/enums/event/event.enum.js";
import type {
  AttachmentMessageView,
  AttachmentUnreadMessagePayload,
} from "../src/modules/attachments/contracts/attachment.types.js";
import { createSocketAttachmentRealtimeAdapter } from "../src/modules/attachments/infrastructure/socket-attachment-realtime.adapter.js";
import { emitEventToRoom } from "../src/utils/socket.util.js";

const CHAT_ID = "chat-1";

const messagePayload = {
  id: "message-1",
  isTextMessage: false,
  textMessageContent: null,
  chatId: CHAT_ID,
  url: null,
  isPollMessage: false,
  audioUrl: null,
  isEdited: false,
  replyToMessageId: null,
  isPinned: false,
  attachments: [{ secureUrl: "https://media.example/attachment.png" }],
  createdAt: new Date("2025-02-12T09:30:00.000Z"),
  updatedAt: new Date("2025-02-12T09:30:00.000Z"),
  sender: {
    id: "actor-user",
    username: "actor-username",
    avatar: "https://media.example/actor-avatar.png",
  },
  poll: null,
  reactions: [],
} satisfies AttachmentMessageView;

const unreadPayload = {
  chatId: CHAT_ID,
  message: {
    attachments: true,
    createdAt: messagePayload.createdAt,
  },
  sender: {
    id: messagePayload.sender.id,
    avatar: messagePayload.sender.avatar,
    username: messagePayload.sender.avatar,
  },
} satisfies AttachmentUnreadMessagePayload;

describe("Socket attachment realtime adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not resolve Socket.IO merely by constructing the adapter", () => {
    const resolveSocketServer = vi.fn(() => ({}) as Server);

    createSocketAttachmentRealtimeAdapter(resolveSocketServer);

    expect(resolveSocketServer).not.toHaveBeenCalled();
    expect(emitEventToRoom).not.toHaveBeenCalled();
  });

  it("emits the exact MESSAGE payload to the chat room", () => {
    const io = { marker: "socket-server" } as unknown as Server;
    const resolveSocketServer = vi.fn(() => io);
    const adapter = createSocketAttachmentRealtimeAdapter(resolveSocketServer);

    adapter.emitMessage(CHAT_ID, messagePayload);

    expect(emitEventToRoom).toHaveBeenCalledOnce();
    expect(emitEventToRoom).toHaveBeenCalledWith({
      io,
      event: Events.MESSAGE,
      room: CHAT_ID,
      data: messagePayload,
    });
    expect(resolveSocketServer).toHaveBeenCalledOnce();
  });

  it("emits the exact UNREAD_MESSAGE payload and reuses the lazily resolved server", () => {
    const io = { marker: "socket-server" } as unknown as Server;
    const resolveSocketServer = vi.fn(() => io);
    const adapter = createSocketAttachmentRealtimeAdapter(resolveSocketServer);

    adapter.emitMessage(CHAT_ID, messagePayload);
    adapter.emitUnreadMessage(CHAT_ID, unreadPayload);

    expect(emitEventToRoom).toHaveBeenNthCalledWith(1, {
      io,
      event: Events.MESSAGE,
      room: CHAT_ID,
      data: messagePayload,
    });
    expect(emitEventToRoom).toHaveBeenNthCalledWith(2, {
      io,
      event: Events.UNREAD_MESSAGE,
      room: CHAT_ID,
      data: unreadPayload,
    });
    expect(resolveSocketServer).toHaveBeenCalledOnce();
  });
});
