import type { Server } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/chat.util.js", () => ({
  joinMembersInChatRoom: vi.fn(),
}));

vi.mock("../src/utils/socket.util.js", () => ({
  emitEvent: vi.fn(),
  emitEventToRoom: vi.fn(),
}));

vi.mock("../src/modules/notifications/push-notification.service.js", () => ({
  sendPushNotification: vi.fn(),
}));

import { Events } from "../src/enums/event/event.enum.js";
import type {
  AcceptedPrivateChatView,
  CreatedFriendRequestView,
} from "../src/modules/friend-requests/contracts/friend-request.types.js";
import { pushFriendRequestNotificationAdapter } from "../src/modules/friend-requests/infrastructure/push-friend-request-notification.adapter.js";
import { createSocketFriendRequestRealtimeAdapter } from "../src/modules/friend-requests/infrastructure/socket-friend-request-realtime.adapter.js";
import { sendPushNotification } from "../src/modules/notifications/push-notification.service.js";
import { joinMembersInChatRoom } from "../src/utils/chat.util.js";
import { emitEvent, emitEventToRoom } from "../src/utils/socket.util.js";

const RECEIVER_ID = "receiver-user";
const SENDER_ID = "sender-user";
const CHAT_ID = "chat-1";

describe("Socket friend-request realtime adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves Socket.IO lazily, caches it once, and maps all effects exactly in call order", () => {
    const io = { marker: "socket-server" } as unknown as Server;
    const resolveSocketServer = vi.fn(() => io);
    const adapter = createSocketFriendRequestRealtimeAdapter(resolveSocketServer);
    const createdRequest = {
      id: "request-1",
      status: "pending",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      sender: { id: SENDER_ID, username: "sender" },
    } as CreatedFriendRequestView;
    const acceptedChat = {
      id: CHAT_ID,
      ChatMembers: [],
      UnreadMessages: [],
      latestMessage: null,
      typingUsers: [],
    } as unknown as AcceptedPrivateChatView;

    expect(resolveSocketServer).not.toHaveBeenCalled();

    adapter.emitNewFriendRequest(RECEIVER_ID, createdRequest);
    adapter.joinMembersInChat([SENDER_ID, RECEIVER_ID], CHAT_ID);
    adapter.emitNewChat(CHAT_ID, acceptedChat);

    expect(resolveSocketServer).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledWith({
      io,
      event: Events.NEW_FRIEND_REQUEST,
      data: createdRequest,
      users: [RECEIVER_ID],
    });
    expect(joinMembersInChatRoom).toHaveBeenCalledWith({
      io,
      memberIds: [SENDER_ID, RECEIVER_ID],
      roomToJoin: CHAT_ID,
    });
    expect(emitEventToRoom).toHaveBeenCalledWith({
      io,
      event: Events.NEW_CHAT,
      data: acceptedChat,
      room: CHAT_ID,
    });

    expect(vi.mocked(emitEvent).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(joinMembersInChatRoom).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(joinMembersInChatRoom).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(emitEventToRoom).mock.invocationCallOrder[0],
    );
  });

  it("does not resolve Socket.IO merely by importing or constructing the adapter", () => {
    const resolveSocketServer = vi.fn(() => ({}) as Server);

    createSocketFriendRequestRealtimeAdapter(resolveSocketServer);

    expect(resolveSocketServer).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
    expect(joinMembersInChatRoom).not.toHaveBeenCalled();
    expect(emitEventToRoom).not.toHaveBeenCalled();
  });
});

describe("push friend-request notification adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates token and body directly to the provider-neutral push service", () => {
    pushFriendRequestNotificationAdapter.notify({
      recipientToken: "opaque-recipient-token",
      body: "A friend-request notification",
    });

    expect(sendPushNotification).toHaveBeenCalledTimes(1);
    expect(sendPushNotification).toHaveBeenCalledWith({
      recipientToken: "opaque-recipient-token",
      body: "A friend-request notification",
    });
  });
});
