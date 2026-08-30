import { readFileSync } from "node:fs";
import type { Server } from "socket.io";
import { describe, expect, it, vi } from "vitest";

import { Events } from "../src/enums/event/event.enum.js";
import type { SocketConnectionDirectory } from "../src/socket/connection-directory.js";
import {
  disconnectMembersFromChatRoom,
  joinMembersInChatRoom,
} from "../src/utils/chat.util.js";
import { emitEvent, getMemberSockets } from "../src/utils/socket.util.js";

type SocketLookupDirectory = Pick<SocketConnectionDirectory, "getSockets">;

const createSocketServer = () => {
  const emit = vi.fn();
  const socketsJoin = vi.fn();
  const socketsLeave = vi.fn();
  const io = {
    to: vi.fn(() => ({ emit })),
    in: vi.fn(() => ({ socketsJoin, socketsLeave })),
  } as unknown as Server;

  return { emit, io, socketsJoin, socketsLeave };
};

describe("directory-backed direct-user delivery", () => {
  it("resolves logical users asynchronously and preserves stable first-seen socket order", async () => {
    const getSockets = vi.fn(async (userId: string): Promise<string[]> => {
      if (userId === "user-a") {
        return ["remote-a-1", "shared-socket", "remote-a-2"];
      }
      return ["remote-b-1", "shared-socket"];
    });
    const directory: SocketLookupDirectory = { getSockets };

    await expect(getMemberSockets(["user-a", "user-b"], directory)).resolves.toEqual([
      "remote-a-1",
      "shared-socket",
      "remote-a-2",
      "remote-b-1",
    ]);
    expect(getSockets).toHaveBeenNthCalledWith(1, "user-a");
    expect(getSockets).toHaveBeenNthCalledWith(2, "user-b");
  });

  it("returns an empty list without consulting the directory for no users", async () => {
    const getSockets = vi.fn<SocketLookupDirectory["getSockets"]>();

    await expect(getMemberSockets([], { getSockets })).resolves.toEqual([]);
    expect(getSockets).not.toHaveBeenCalled();
  });

  it("passes directory lookup failures through unchanged", async () => {
    const failure = new Error("directory lookup failed");
    const getSockets = vi.fn<SocketLookupDirectory["getSockets"]>()
      .mockRejectedValue(failure);

    await expect(getMemberSockets(["user-a"], { getSockets })).rejects.toBe(failure);
  });

  it("emits the exact event once through Socket.IO's socket-ID target", async () => {
    const runtime = createSocketServer();
    const directory: SocketLookupDirectory = {
      getSockets: vi.fn()
        .mockResolvedValueOnce(["remote-a", "shared"])
        .mockResolvedValueOnce(["remote-b", "shared"]),
    };
    const payload = { chatId: "chat-1" };

    await emitEvent({
      io: runtime.io,
      directory,
      event: Events.NEW_CHAT,
      users: ["user-a", "user-b"],
      data: payload,
    });

    expect(runtime.io.to).toHaveBeenCalledOnce();
    expect(runtime.io.to).toHaveBeenCalledWith(["remote-a", "shared", "remote-b"]);
    expect(runtime.emit).toHaveBeenCalledOnce();
    expect(runtime.emit).toHaveBeenCalledWith(Events.NEW_CHAT, payload);
  });

  it("does not address Socket.IO when all logical users have no sockets", async () => {
    const runtime = createSocketServer();
    const directory: SocketLookupDirectory = {
      getSockets: vi.fn().mockResolvedValue([]),
    };

    await emitEvent({
      io: runtime.io,
      directory,
      event: Events.NEW_CHAT,
      users: ["offline-user"],
      data: { chatId: "chat-1" },
    });

    expect(runtime.io.to).not.toHaveBeenCalled();
    expect(runtime.emit).not.toHaveBeenCalled();
  });

  it("does not emit after a directory lookup failure", async () => {
    const runtime = createSocketServer();
    const failure = new Error("directory unavailable");
    const directory: SocketLookupDirectory = {
      getSockets: vi.fn().mockRejectedValue(failure),
    };

    await expect(emitEvent({
      io: runtime.io,
      directory,
      event: Events.NEW_CHAT,
      users: ["user-a"],
      data: { chatId: "chat-1" },
    })).rejects.toBe(failure);
    expect(runtime.io.to).not.toHaveBeenCalled();
    expect(runtime.emit).not.toHaveBeenCalled();
  });
});

describe("directory-backed cluster room membership", () => {
  it("joins every resolved socket ID through the cluster-capable Socket.IO operator", async () => {
    const runtime = createSocketServer();
    const directory: SocketLookupDirectory = {
      getSockets: vi.fn()
        .mockResolvedValueOnce(["remote-a", "shared"])
        .mockResolvedValueOnce(["remote-b", "shared"]),
    };

    await joinMembersInChatRoom({
      io: runtime.io,
      directory,
      memberIds: ["user-a", "user-b"],
      roomToJoin: "chat-1",
    });

    expect(runtime.io.in).toHaveBeenCalledOnce();
    expect(runtime.io.in).toHaveBeenCalledWith(["remote-a", "shared", "remote-b"]);
    expect(runtime.socketsJoin).toHaveBeenCalledOnce();
    expect(runtime.socketsJoin).toHaveBeenCalledWith("chat-1");
    expect(runtime.socketsLeave).not.toHaveBeenCalled();
  });

  it("removes every resolved socket ID through the cluster-capable Socket.IO operator", async () => {
    const runtime = createSocketServer();
    const directory: SocketLookupDirectory = {
      getSockets: vi.fn().mockResolvedValue(["remote-a", "remote-b"]),
    };

    await disconnectMembersFromChatRoom({
      io: runtime.io,
      directory,
      memberIds: ["user-a"],
      roomToLeave: "chat-1",
    });

    expect(runtime.io.in).toHaveBeenCalledOnce();
    expect(runtime.io.in).toHaveBeenCalledWith(["remote-a", "remote-b"]);
    expect(runtime.socketsLeave).toHaveBeenCalledOnce();
    expect(runtime.socketsLeave).toHaveBeenCalledWith("chat-1");
    expect(runtime.socketsJoin).not.toHaveBeenCalled();
  });

  it("does not create a room operator when there are no matching sockets", async () => {
    const runtime = createSocketServer();
    const directory: SocketLookupDirectory = {
      getSockets: vi.fn().mockResolvedValue([]),
    };

    await joinMembersInChatRoom({
      io: runtime.io,
      directory,
      memberIds: ["offline-user"],
      roomToJoin: "chat-1",
    });
    await disconnectMembersFromChatRoom({
      io: runtime.io,
      directory,
      memberIds: ["offline-user"],
      roomToLeave: "chat-1",
    });

    expect(runtime.io.in).not.toHaveBeenCalled();
    expect(runtime.socketsJoin).not.toHaveBeenCalled();
    expect(runtime.socketsLeave).not.toHaveBeenCalled();
  });

  it("passes join and leave directory failures through without a partial room operation", async () => {
    const runtime = createSocketServer();
    const failure = new Error("directory unavailable");
    const directory: SocketLookupDirectory = {
      getSockets: vi.fn().mockRejectedValue(failure),
    };

    await expect(joinMembersInChatRoom({
      io: runtime.io,
      directory,
      memberIds: ["user-a"],
      roomToJoin: "chat-1",
    })).rejects.toBe(failure);
    await expect(disconnectMembersFromChatRoom({
      io: runtime.io,
      directory,
      memberIds: ["user-a"],
      roomToLeave: "chat-1",
    })).rejects.toBe(failure);

    expect(runtime.io.in).not.toHaveBeenCalled();
    expect(runtime.socketsJoin).not.toHaveBeenCalled();
    expect(runtime.socketsLeave).not.toHaveBeenCalled();
  });

  it("contains no process-local socket-map or registry lookup", () => {
    const source = readFileSync(
      new URL("../src/utils/chat.util.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("io.sockets.sockets.get");
    expect(source).not.toContain("socketConnectionRegistry");
    expect(source).toContain("io.in(memberSocketIds).socketsJoin");
    expect(source).toContain("io.in(memberSocketIds).socketsLeave");
  });
});
