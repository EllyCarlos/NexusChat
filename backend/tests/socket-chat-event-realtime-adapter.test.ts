import type { Server, Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Events } from "../src/enums/event/event.enum.js";
import type {
  ChatRealtimeMessageView,
  DeleteReactionRealtimePayload,
  MessageDeleteRealtimePayload,
  MessageEditRealtimePayload,
  MessageRealtimePayload,
  MessageSeenRealtimePayload,
  NewReactionRealtimePayload,
  PinLimitReachedRealtimePayload,
  PinMessageRealtimePayload,
  UnpinMessageRealtimePayload,
  UnreadMessageRealtimePayload,
  UserTypingRealtimePayload,
  VoteInRealtimePayload,
  VoteOutRealtimePayload,
} from "../src/socket/realtime/contracts/chat-realtime.types.js";
import {
  createSocketChatEventRealtimeAdapter,
  type SocketChatEventRealtimeAdapter,
} from "../src/socket/realtime/infrastructure/socket-chat-event-realtime.adapter.js";

const CHAT_ID = "chat-1";
const MESSAGE_ID = "message-1";
const ACTOR = {
  id: "actor-user",
  username: "trusted-actor",
  avatar: "https://media.example/actor.png",
};
const CREATED_AT = new Date("2026-08-28T08:00:00.000Z");
const UPDATED_AT = new Date("2026-08-28T08:05:00.000Z");

const messageView = {
  id: MESSAGE_ID,
  isTextMessage: true,
  textMessageContent: "hello",
  chatId: CHAT_ID,
  url: null,
  isPollMessage: false,
  audioUrl: null,
  isEdited: false,
  replyToMessageId: "reply-1",
  isPinned: false,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  sender: ACTOR,
  attachments: [{ secureUrl: "https://media.example/attachment.png" }],
  poll: {
    question: "Choose",
    options: ["one", "two"],
    multipleAnswers: false,
    votes: [{ optionIndex: 1, user: ACTOR }],
  },
  reactions: [{ user: ACTOR, reaction: "like" }],
  replyToMessage: {
    id: "reply-1",
    textMessageContent: "earlier",
    isPollMessage: false,
    url: null,
    audioUrl: null,
    sender: ACTOR,
    attachments: [{ secureUrl: "https://media.example/reply.png" }],
  },
} satisfies ChatRealtimeMessageView;

const messagePayload = {
  ...messageView,
  isNew: true,
} satisfies MessageRealtimePayload;

const unreadPayload = {
  chatId: CHAT_ID,
  message: {
    textMessageContent: "hello",
    url: false,
    attachments: false,
    poll: false,
    createdAt: CREATED_AT,
    audio: false,
  },
  sender: ACTOR,
} satisfies UnreadMessageRealtimePayload;

const messageSeenPayload = {
  user: ACTOR,
  chatId: CHAT_ID,
  readAt: UPDATED_AT,
} satisfies MessageSeenRealtimePayload;

const messageEditPayload = {
  chatId: CHAT_ID,
  messageId: MESSAGE_ID,
  updatedTextMessageContent: "edited",
} satisfies MessageEditRealtimePayload;

const messageDeletePayload = {
  chatId: CHAT_ID,
  messageId: MESSAGE_ID,
} satisfies MessageDeleteRealtimePayload;

const newReactionPayload = {
  chatId: CHAT_ID,
  messageId: MESSAGE_ID,
  user: ACTOR,
  reaction: "like",
} satisfies NewReactionRealtimePayload;

const deleteReactionPayload = {
  chatId: CHAT_ID,
  messageId: MESSAGE_ID,
  userId: ACTOR.id,
} satisfies DeleteReactionRealtimePayload;

const typingPayload = {
  user: ACTOR,
  chatId: CHAT_ID,
} satisfies UserTypingRealtimePayload;

const voteInPayload = {
  messageId: MESSAGE_ID,
  user: ACTOR,
  optionIndex: 1,
  chatId: CHAT_ID,
} satisfies VoteInRealtimePayload;

const voteOutPayload = {
  chatId: CHAT_ID,
  messageId: MESSAGE_ID,
  userId: ACTOR.id,
  optionIndex: 1,
} satisfies VoteOutRealtimePayload;

const pinLimitReachedPayload = {
  oldestPinId: "oldest-pin",
  messageId: "oldest-message",
  chatId: CHAT_ID,
} satisfies PinLimitReachedRealtimePayload;

const pinMessagePayload = {
  id: "pin-1",
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  message: {
    ...messageView,
    audioPublicId: "raw-audio-public-id",
  },
} satisfies PinMessageRealtimePayload;

const unpinMessagePayload = {
  pinId: "pin-1",
  chatId: CHAT_ID,
  messageId: MESSAGE_ID,
} satisfies UnpinMessageRealtimePayload;

type AdapterHarness = {
  adapter: SocketChatEventRealtimeAdapter;
  ioTo: ReturnType<typeof vi.fn>;
  roomEmit: ReturnType<typeof vi.fn>;
  broadcastTo: ReturnType<typeof vi.fn>;
  broadcastRoomEmit: ReturnType<typeof vi.fn>;
};

const createHarness = (): AdapterHarness => {
  const roomEmit = vi.fn();
  const ioTo = vi.fn(() => ({ emit: roomEmit }));
  const broadcastRoomEmit = vi.fn();
  const broadcastTo = vi.fn(() => ({ emit: broadcastRoomEmit }));
  const io = { to: ioTo } as unknown as Server;
  const socket = {
    broadcast: { to: broadcastTo },
  } as unknown as Socket;

  return {
    adapter: createSocketChatEventRealtimeAdapter({ io, socket }),
    ioTo,
    roomEmit,
    broadcastTo,
    broadcastRoomEmit,
  };
};

describe("Socket chat-event realtime adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const roomDeliveryCases = [
    {
      event: Events.MESSAGE,
      payload: messagePayload,
      deliver: (adapter: SocketChatEventRealtimeAdapter) => adapter.emitMessage(CHAT_ID, messagePayload),
    },
    {
      event: Events.UNREAD_MESSAGE,
      payload: unreadPayload,
      deliver: (adapter: SocketChatEventRealtimeAdapter) => adapter.emitUnreadMessage(CHAT_ID, unreadPayload),
    },
    {
      event: Events.MESSAGE_SEEN,
      payload: messageSeenPayload,
      deliver: (adapter: SocketChatEventRealtimeAdapter) => adapter.emitMessageSeen(CHAT_ID, messageSeenPayload),
    },
    {
      event: Events.MESSAGE_EDIT,
      payload: messageEditPayload,
      deliver: (adapter: SocketChatEventRealtimeAdapter) => adapter.emitMessageEdit(CHAT_ID, messageEditPayload),
    },
    {
      event: Events.MESSAGE_DELETE,
      payload: messageDeletePayload,
      deliver: (adapter: SocketChatEventRealtimeAdapter) => adapter.emitMessageDelete(CHAT_ID, messageDeletePayload),
    },
    {
      event: Events.NEW_REACTION,
      payload: newReactionPayload,
      deliver: (adapter: SocketChatEventRealtimeAdapter) => adapter.emitNewReaction(CHAT_ID, newReactionPayload),
    },
    {
      event: Events.DELETE_REACTION,
      payload: deleteReactionPayload,
      deliver: (adapter: SocketChatEventRealtimeAdapter) => adapter.emitDeleteReaction(CHAT_ID, deleteReactionPayload),
    },
    {
      event: Events.VOTE_IN,
      payload: voteInPayload,
      deliver: (adapter: SocketChatEventRealtimeAdapter) => adapter.emitVoteIn(CHAT_ID, voteInPayload),
    },
    {
      event: Events.VOTE_OUT,
      payload: voteOutPayload,
      deliver: (adapter: SocketChatEventRealtimeAdapter) => adapter.emitVoteOut(CHAT_ID, voteOutPayload),
    },
    {
      event: Events.PIN_LIMIT_REACHED,
      payload: pinLimitReachedPayload,
      deliver: (adapter: SocketChatEventRealtimeAdapter) => adapter.emitPinLimitReached(CHAT_ID, pinLimitReachedPayload),
    },
    {
      event: Events.PIN_MESSAGE,
      payload: pinMessagePayload,
      deliver: (adapter: SocketChatEventRealtimeAdapter) => adapter.emitPinMessage(CHAT_ID, pinMessagePayload),
    },
    {
      event: Events.UNPIN_MESSAGE,
      payload: unpinMessagePayload,
      deliver: (adapter: SocketChatEventRealtimeAdapter) => adapter.emitUnpinMessage(CHAT_ID, unpinMessagePayload),
    },
  ] as const;

  it.each(roomDeliveryCases)(
    "maps $event to the exact room and payload including the sender",
    ({ deliver, event, payload }) => {
      const harness = createHarness();

      deliver(harness.adapter);

      expect(harness.ioTo).toHaveBeenCalledOnce();
      expect(harness.ioTo).toHaveBeenCalledWith(CHAT_ID);
      expect(harness.roomEmit).toHaveBeenCalledOnce();
      expect(harness.roomEmit).toHaveBeenCalledWith(event, payload);
      expect(harness.broadcastTo).not.toHaveBeenCalled();
      expect(harness.broadcastRoomEmit).not.toHaveBeenCalled();
    },
  );

  it("maps USER_TYPING through broadcast-to-room so the sender is excluded", () => {
    const harness = createHarness();

    harness.adapter.broadcastTypingToOthers(CHAT_ID, typingPayload);

    expect(harness.broadcastTo).toHaveBeenCalledOnce();
    expect(harness.broadcastTo).toHaveBeenCalledWith(CHAT_ID);
    expect(harness.broadcastRoomEmit).toHaveBeenCalledOnce();
    expect(harness.broadcastRoomEmit).toHaveBeenCalledWith(Events.USER_TYPING, typingPayload);
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(harness.roomEmit).not.toHaveBeenCalled();
  });

  it("passes MESSAGE through without adding a provider ID and preserves the PIN_MESSAGE provider ID", () => {
    const harness = createHarness();

    harness.adapter.emitMessage(CHAT_ID, messagePayload);
    harness.adapter.emitPinMessage(CHAT_ID, pinMessagePayload);

    expect(messagePayload).not.toHaveProperty("audioPublicId");
    expect(harness.roomEmit).toHaveBeenNthCalledWith(1, Events.MESSAGE, messagePayload);
    expect(harness.roomEmit).toHaveBeenNthCalledWith(2, Events.PIN_MESSAGE, pinMessagePayload);
    expect(pinMessagePayload.message.audioPublicId).toBe("raw-audio-public-id");
  });

  it("allows an underlying room emit failure to propagate synchronously", () => {
    const harness = createHarness();
    const deliveryError = new Error("room delivery failed");
    harness.roomEmit.mockImplementationOnce(() => {
      throw deliveryError;
    });

    expect(() => harness.adapter.emitMessage(CHAT_ID, messagePayload)).toThrow(deliveryError);
  });

  it("allows an underlying sender-excluding emit failure to propagate synchronously", () => {
    const harness = createHarness();
    const deliveryError = new Error("broadcast delivery failed");
    harness.broadcastRoomEmit.mockImplementationOnce(() => {
      throw deliveryError;
    });

    expect(() => harness.adapter.broadcastTypingToOthers(CHAT_ID, typingPayload)).toThrow(deliveryError);
  });
});
