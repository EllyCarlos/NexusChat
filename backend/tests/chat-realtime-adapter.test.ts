import type { Server } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/chat.util.js", () => ({
  disconnectMembersFromChatRoom: vi.fn(),
  joinMembersInChatRoom: vi.fn(),
}));

vi.mock("../src/utils/socket.util.js", () => ({
  emitEvent: vi.fn(),
  emitEventToRoom: vi.fn(),
}));

import { Events } from "../src/enums/event/event.enum.js";
import { createSocketChatRealtimeAdapter } from "../src/modules/chats/infrastructure/socket-chat-realtime.adapter.js";
import {
  disconnectMembersFromChatRoom,
  joinMembersInChatRoom,
} from "../src/utils/chat.util.js";
import { emitEvent, emitEventToRoom } from "../src/utils/socket.util.js";

const CHAT_ID = "chat-1";
const NEW_MEMBERS = ["member-3", "member-4"];
const OLD_MEMBERS = ["actor-user", "member-1", "member-2"];
const REMOVED_MEMBERS = ["member-2"];
const REMAINING_MEMBERS = ["actor-user", "member-1"];

const calledBefore = (first: ReturnType<typeof vi.fn>, second: ReturnType<typeof vi.fn>) => {
  expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0]);
};

describe("Socket chat realtime adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not resolve Socket.IO merely by importing or constructing the adapter", () => {
    const resolveSocketServer = vi.fn(() => ({}) as Server);

    createSocketChatRealtimeAdapter(resolveSocketServer);

    expect(resolveSocketServer).not.toHaveBeenCalled();
    expect(joinMembersInChatRoom).not.toHaveBeenCalled();
    expect(disconnectMembersFromChatRoom).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
    expect(emitEventToRoom).not.toHaveBeenCalled();
  });

  it("joins created-chat members and emits the exact NEW_CHAT room event with one cached server", () => {
    const io = { marker: "socket-server" } as unknown as Server;
    const resolveSocketServer = vi.fn(() => io);
    const realtime = createSocketChatRealtimeAdapter(resolveSocketServer);
    const payload = { id: CHAT_ID, typingUsers: [] } as never;

    realtime.joinMembers(OLD_MEMBERS, CHAT_ID);
    realtime.emitNewChatToRoom(CHAT_ID, payload);

    expect(joinMembersInChatRoom).toHaveBeenCalledWith({
      io,
      memberIds: OLD_MEMBERS,
      roomToJoin: CHAT_ID,
    });
    expect(emitEventToRoom).toHaveBeenCalledWith({
      io,
      event: Events.NEW_CHAT,
      room: CHAT_ID,
      data: payload,
    });
    calledBefore(vi.mocked(joinMembersInChatRoom), vi.mocked(emitEventToRoom));
    expect(resolveSocketServer).toHaveBeenCalledOnce();
  });

  it("targets new and old member snapshots with the exact add-member events", () => {
    const io = { marker: "socket-server" } as unknown as Server;
    const resolveSocketServer = vi.fn(() => io);
    const realtime = createSocketChatRealtimeAdapter(resolveSocketServer);
    const newChatPayload = { id: CHAT_ID, typingUsers: [], UnreadMessages: [] } as never;
    const membersAddedPayload = { chatId: CHAT_ID, members: [] };

    realtime.joinMembers(NEW_MEMBERS, CHAT_ID);
    realtime.emitNewChatToMembers(NEW_MEMBERS, newChatPayload);
    realtime.emitMembersAdded(OLD_MEMBERS, membersAddedPayload);

    expect(joinMembersInChatRoom).toHaveBeenCalledWith({
      io,
      memberIds: NEW_MEMBERS,
      roomToJoin: CHAT_ID,
    });
    expect(emitEvent).toHaveBeenNthCalledWith(1, {
      io,
      event: Events.NEW_CHAT,
      users: NEW_MEMBERS,
      data: newChatPayload,
    });
    expect(emitEvent).toHaveBeenNthCalledWith(2, {
      io,
      event: Events.NEW_MEMBER_ADDED,
      users: OLD_MEMBERS,
      data: membersAddedPayload,
    });
    calledBefore(vi.mocked(joinMembersInChatRoom), vi.mocked(emitEvent));
    expect(vi.mocked(emitEvent).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(emitEvent).mock.invocationCallOrder[1] as number,
    );
    expect(resolveSocketServer).toHaveBeenCalledOnce();
  });

  it("disconnects removed members and targets removed then remaining snapshots exactly", () => {
    const io = { marker: "socket-server" } as unknown as Server;
    const resolveSocketServer = vi.fn(() => io);
    const realtime = createSocketChatRealtimeAdapter(resolveSocketServer);
    const deletedPayload = { chatId: CHAT_ID };
    const removedPayload = { chatId: CHAT_ID, membersId: REMOVED_MEMBERS };

    realtime.disconnectMembers(REMOVED_MEMBERS, CHAT_ID);
    realtime.emitDeleteChat(REMOVED_MEMBERS, deletedPayload);
    realtime.emitMembersRemoved(REMAINING_MEMBERS, removedPayload);

    expect(disconnectMembersFromChatRoom).toHaveBeenCalledWith({
      io,
      memberIds: REMOVED_MEMBERS,
      roomToLeave: CHAT_ID,
    });
    expect(emitEvent).toHaveBeenNthCalledWith(1, {
      io,
      event: Events.DELETE_CHAT,
      users: REMOVED_MEMBERS,
      data: deletedPayload,
    });
    expect(emitEvent).toHaveBeenNthCalledWith(2, {
      io,
      event: Events.MEMBER_REMOVED,
      users: REMAINING_MEMBERS,
      data: removedPayload,
    });
    calledBefore(vi.mocked(disconnectMembersFromChatRoom), vi.mocked(emitEvent));
    expect(vi.mocked(emitEvent).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(emitEvent).mock.invocationCallOrder[1] as number,
    );
    expect(resolveSocketServer).toHaveBeenCalledOnce();
  });

  it("emits the exact GROUP_CHAT_UPDATE payload to the chat room", () => {
    const io = { marker: "socket-server" } as unknown as Server;
    const resolveSocketServer = vi.fn(() => io);
    const realtime = createSocketChatRealtimeAdapter(resolveSocketServer);
    const payload = {
      chatId: CHAT_ID,
      chatAvatar: "https://media.example/group.png",
      chatName: "Renamed",
    };

    realtime.emitGroupChatUpdate(CHAT_ID, payload);

    expect(emitEventToRoom).toHaveBeenCalledWith({
      io,
      event: Events.GROUP_CHAT_UPDATE,
      room: CHAT_ID,
      data: payload,
    });
    expect(resolveSocketServer).toHaveBeenCalledOnce();
  });
});
