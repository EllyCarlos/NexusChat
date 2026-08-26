import { readFileSync } from "node:fs";
import type { NextFunction } from "connect";
import type { Server, Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env.config.js", () => ({
  config: { auth: { jwtSecret: "obvious-fake-socket-test-secret" } },
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    user: { update: vi.fn(), findUnique: vi.fn() },
    chatMembers: { findMany: vi.fn() },
    chat: { findFirst: vi.fn(), update: vi.fn() },
    message: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
    poll: { create: vi.fn() },
    unreadMessages: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    reactions: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    vote: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    pinnedMessages: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    attachment: { deleteMany: vi.fn() },
  },
}));

vi.mock("../src/utils/auth.util.js", () => ({
  deleteFilesFromCloudinary: vi.fn(),
  uploadAudioToCloudinary: vi.fn(),
  uploadEncryptedAudioToCloudinary: vi.fn(),
}));

vi.mock("../src/utils/generic.js", () => ({ sendPushNotification: vi.fn() }));
vi.mock("../src/socket/webrtc/socket.js", () => ({ default: vi.fn() }));

import { Events } from "../src/enums/event/event.enum.js";
import { prisma } from "../src/lib/prisma.lib.js";
import {
  hasPlausibleJwtShape,
  socketAuthenticatorMiddleware,
} from "../src/middlewares/socket-auth.middleware.js";
import {
  MAX_CONNECTIONS_PER_USER,
  SocketConnectionRegistry,
  SocketPresenceWriteQueue,
  socketConnectionRegistry,
} from "../src/socket/connection-registry.js";
import registerSocketHandlers from "../src/socket/socket.js";
import { SOCKET_EVENT_LIMITS, SocketEventRateLimiter } from "../src/socket/socket-security.js";
import { emitEvent, getMemberSockets } from "../src/utils/socket.util.js";

const USER_A = "cm20000000000000000000001";
const USER_B = "cm20000000000000000000002";

type RegisteredHandler = (payload?: unknown) => Promise<void> | void;

const createRuntime = (registry = new SocketConnectionRegistry()) => {
  let connectionHandler: ((socket: Socket) => Promise<void>) | undefined;
  const directEmit = vi.fn();
  const io = {
    on: vi.fn((event: string, handler: (socket: Socket) => Promise<void>) => {
      expect(event).toBe("connection");
      connectionHandler = handler;
      return io;
    }),
    to: vi.fn(() => ({ emit: directEmit })),
  };

  registerSocketHandlers(io as unknown as Server, {
    registry,
    limiter: new SocketEventRateLimiter(),
    presenceWriteQueue: new SocketPresenceWriteQueue(),
  });

  const makeSocket = (userId: string, socketId: string) => {
    const handlers = new Map<string, RegisteredHandler>();
    const broadcastEmit = vi.fn();
    const socket = {
      id: socketId,
      user: { id: userId, username: userId, avatar: "avatar" },
      on: vi.fn((event: string, handler: RegisteredHandler) => {
        handlers.set(event, handler);
        return socket;
      }),
      emit: vi.fn(),
      join: vi.fn(),
      disconnect: vi.fn(),
      broadcast: {
        emit: broadcastEmit,
        to: vi.fn(() => ({ emit: vi.fn() })),
      },
    };
    return {
      handlers,
      socket,
      broadcastEmit,
      disconnect: async () => handlers.get("disconnect")?.(),
    };
  };

  const connect = async (userId: string, socketId: string) => {
    const client = makeSocket(userId, socketId);
    await connectionHandler!(client.socket as unknown as Socket);
    return client;
  };

  return { connect, directEmit, makeSocket, registry, runConnection: (socket: Socket) => connectionHandler!(socket) };
};

beforeEach(() => {
  vi.clearAllMocks();
  socketConnectionRegistry.clear();
  vi.mocked(prisma.user.update).mockResolvedValue({} as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.chatMembers.findMany).mockResolvedValue([]);
});

describe("multi-socket presence lifecycle", () => {
  it("writes presence only on first-connect and final-disconnect transitions", async () => {
    const runtime = createRuntime();
    const first = await runtime.connect(USER_A, "socket-a1");
    const second = await runtime.connect(USER_A, "socket-a2");

    expect(runtime.registry.connectionCount(USER_A)).toBe(2);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenLastCalledWith({
      where: { id: USER_A },
      data: { isOnline: true },
    });
    expect(first.broadcastEmit).toHaveBeenCalledWith(Events.ONLINE_USER, { userId: USER_A });
    expect(second.broadcastEmit).not.toHaveBeenCalledWith(Events.ONLINE_USER, expect.anything());

    await first.disconnect();
    expect(runtime.registry.isOnline(USER_A)).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);

    await second.disconnect();
    expect(runtime.registry.isOnline(USER_A)).toBe(false);
    expect(prisma.user.update).toHaveBeenCalledTimes(2);
    expect(prisma.user.update).toHaveBeenLastCalledWith({
      where: { id: USER_A },
      data: { isOnline: false, lastSeen: expect.any(Date) },
    });
    expect(second.broadcastEmit).toHaveBeenCalledWith(Events.OFFLINE_USER, { userId: USER_A });
  });

  it("does not flicker offline when a reconnect overlaps the older socket", async () => {
    const runtime = createRuntime();
    const oldSocket = await runtime.connect(USER_A, "old-socket");
    const newSocket = await runtime.connect(USER_A, "new-socket");

    await oldSocket.disconnect();

    expect(runtime.registry.getSockets(USER_A)).toEqual(["new-socket"]);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(oldSocket.broadcastEmit).not.toHaveBeenCalledWith(Events.OFFLINE_USER, expect.anything());
    await newSocket.disconnect();
  });

  it("handles near-simultaneous connects and disconnects with one transition each", async () => {
    const runtime = createRuntime();
    const first = runtime.makeSocket(USER_A, "parallel-a");
    const second = runtime.makeSocket(USER_A, "parallel-b");

    await Promise.all([
      runtime.runConnection(first.socket as unknown as Socket),
      runtime.runConnection(second.socket as unknown as Socket),
    ]);
    expect(runtime.registry.connectionCount(USER_A)).toBe(2);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);

    await Promise.all([first.disconnect(), second.disconnect()]);
    expect(runtime.registry.connectionCount(USER_A)).toBe(0);
    expect(prisma.user.update).toHaveBeenCalledTimes(2);
  });

  it("keeps registry truth intact when a presence DB write fails", async () => {
    vi.mocked(prisma.user.update).mockRejectedValueOnce(new Error("private database detail"));
    const runtime = createRuntime();

    const client = await runtime.connect(USER_A, "socket-a");
    expect(runtime.registry.isOnline(USER_A)).toBe(true);

    await client.disconnect();
    expect(runtime.registry.isOnline(USER_A)).toBe(false);
  });

  it("ignores a stale disconnect after a newer socket exists", () => {
    const registry = new SocketConnectionRegistry();
    registry.add(USER_A, "old");
    registry.add(USER_A, "new");
    registry.remove(USER_A, "old");
    const staleRemoval = registry.remove(USER_A, "old");

    expect(staleRemoval).toEqual({ removed: false, lastConnection: false });
    expect(registry.getSockets(USER_A)).toEqual(["new"]);
  });

  it("serializes slow presence writes so a later transition wins", async () => {
    const queue = new SocketPresenceWriteQueue();
    const order: string[] = [];
    let releaseOnline: (() => void) | undefined;
    const online = queue.run(USER_A, async () => {
      order.push("online-start");
      await new Promise<void>(resolve => { releaseOnline = resolve; });
      order.push("online-end");
    });
    const offline = queue.run(USER_A, async () => {
      order.push("offline");
    });

    await vi.waitFor(() => expect(releaseOnline).toBeTypeOf("function"));
    expect(order).toEqual(["online-start"]);
    releaseOnline!();
    await Promise.all([online, offline]);
    expect(order).toEqual(["online-start", "online-end", "offline"]);
  });
});

describe("authenticated connection cap", () => {
  it("rejects the ninth socket without disturbing eight existing sockets", async () => {
    const runtime = createRuntime();
    for (let index = 0; index < MAX_CONNECTIONS_PER_USER; index += 1) {
      await runtime.connect(USER_A, `socket-${index}`);
    }

    const rejected = await runtime.connect(USER_A, "socket-over-cap");

    expect(runtime.registry.connectionCount(USER_A)).toBe(MAX_CONNECTIONS_PER_USER);
    expect(rejected.socket.emit).toHaveBeenCalledWith(Events.SECURITY_ERROR, {
      category: "CONNECTION_LIMIT",
      event: "connection",
    });
    expect(rejected.socket.disconnect).toHaveBeenCalledWith(true);
  });

  it("does not let user A's cap affect user B", async () => {
    const runtime = createRuntime();
    for (let index = 0; index < MAX_CONNECTIONS_PER_USER; index += 1) {
      await runtime.connect(USER_A, `socket-a-${index}`);
    }

    const userB = await runtime.connect(USER_B, "socket-b");

    expect(runtime.registry.connectionCount(USER_B)).toBe(1);
    expect(userB.socket.disconnect).not.toHaveBeenCalled();
  });
});

describe("multi-socket direct delivery", () => {
  it("resolves all sockets for ordinary direct-user events", () => {
    socketConnectionRegistry.add(USER_A, "socket-a1");
    socketConnectionRegistry.add(USER_A, "socket-a2");
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })) } as unknown as Server;

    expect(getMemberSockets([USER_A])).toEqual(["socket-a1", "socket-a2"]);
    emitEvent({ io, event: Events.NEW_CHAT, users: [USER_A], data: { id: "chat" } });
    expect(io.to).toHaveBeenCalledWith(["socket-a1", "socket-a2"]);
  });
});

describe("pre-auth cheap rejection", () => {
  it("rejects malformed and oversized token shapes before Prisma", async () => {
    expect(hasPlausibleJwtShape("not-a-jwt")).toBe(false);
    expect(hasPlausibleJwtShape(`a.${"b".repeat(4_100)}.c`)).toBe(false);
    const next = vi.fn();
    const socket = { handshake: { query: { token: "not-a-jwt" } } } as unknown as Socket;

    await socketAuthenticatorMiddleware(socket, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("keeps the explicit Engine.IO byte cap and namespace timeout", () => {
    const source = readFileSync(new URL("../src/bootstrap/create-server.ts", import.meta.url), "utf8");
    expect(source).toContain("connectTimeout: 10_000");
    expect(source).toContain("maxHttpBufferSize: 1_000_000");
    expect(source).not.toContain("req.ip");
    expect(source).not.toContain("trust proxy");
  });
});

describe("Socket limiter clock behavior", () => {
  it("expires resource buckets using an injectable deterministic clock", () => {
    let now = 0;
    const limiter = new SocketEventRateLimiter(100, () => now);
    const key = [USER_A, "chat"];

    for (let index = 0; index < 8; index += 1) {
      expect(limiter.consume(SOCKET_EVENT_LIMITS.messageChatBurst, key)).toBe(true);
    }
    expect(limiter.consume(SOCKET_EVENT_LIMITS.messageChatBurst, key)).toBe(false);

    now = 5_001;
    expect(limiter.consume(SOCKET_EVENT_LIMITS.messageChatBurst, key)).toBe(true);
  });
});
