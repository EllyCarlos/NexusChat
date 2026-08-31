import type { Server, Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    reactions: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
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
import {
  SocketConnectionRegistry,
  SocketPresenceWriteQueue,
} from "../src/socket/connection-registry.js";
import { createLocalSocketConnectionDirectory } from "../src/socket/local-connection-directory.adapter.js";
import { LocalSocketEventRateLimitAdapter } from "../src/socket/local-socket-event-rate-limit.adapter.js";
import registerSocketHandlers from "../src/socket/socket.js";
import registerWebRtcHandlers from "../src/socket/webrtc/socket.js";

const USER_ID = "cm40000000000000000000001";
const OTHER_USER_ID = "cm40000000000000000000002";
const CHAT_A = "cm40000000000000000000003";
const CHAT_B = "cm40000000000000000000004";

type RegisteredHandler = (payload?: unknown) => Promise<void> | void;

const expectedRootRegistrations = [
  "disconnect",
  Events.MESSAGE,
  Events.MESSAGE_SEEN,
  Events.MESSAGE_EDIT,
  Events.MESSAGE_DELETE,
  Events.NEW_REACTION,
  Events.DELETE_REACTION,
  Events.USER_TYPING,
  Events.VOTE_IN,
  Events.VOTE_OUT,
  Events.PIN_MESSAGE,
  Events.UNPIN_MESSAGE,
];

const makeSocket = (
  user: { id: string; username: string; avatar: string } | null = {
    id: USER_ID,
    username: "actor",
    avatar: "actor-avatar",
  },
  broadcastBySocket = new Map<string, ReturnType<typeof vi.fn>>(),
) => {
  const handlers = new Map<string, RegisteredHandler>();
  const broadcastEmit = vi.fn();
  const socket = {
    id: "socket-root-test",
    user,
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
  broadcastBySocket.set(socket.id, broadcastEmit);

  return { broadcastEmit, handlers, socket };
};

const makeRuntime = () => {
  let connectionHandler: ((socket: Socket) => Promise<void>) | undefined;
  const broadcastBySocket = new Map<string, ReturnType<typeof vi.fn>>();
  const io = {
    on: vi.fn((event: string, handler: (socket: Socket) => Promise<void>) => {
      expect(event).toBe("connection");
      connectionHandler = handler;
      return io;
    }),
    to: vi.fn(() => ({ emit: vi.fn() })),
    emit: vi.fn(),
    except: vi.fn((socketId: string) => ({
      emit: (...arguments_: unknown[]) => broadcastBySocket.get(socketId)?.(...arguments_),
    })),
    local: {
      disconnectSockets: vi.fn(),
      in: vi.fn(() => ({ disconnectSockets: vi.fn() })),
    },
  };
  const registry = new SocketConnectionRegistry();
  const directory = createLocalSocketConnectionDirectory(registry);
  const limiter = new LocalSocketEventRateLimitAdapter();
  const presenceWriteQueue = new SocketPresenceWriteQueue();

  registerSocketHandlers(io as unknown as Server, {
    directory,
    limiter,
    presenceWriteQueue,
  });

  return {
    io,
    directory,
    limiter,
    presenceWriteQueue,
    registry,
    runConnection: async (socket: Socket) => {
      expect(connectionHandler).toBeDefined();
      await connectionHandler!(socket);
    },
    makeSocket: (user?: Parameters<typeof makeSocket>[0]) =>
      makeSocket(user, broadcastBySocket),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.update).mockResolvedValue({} as never);
  vi.mocked(prisma.chatMembers.findMany).mockResolvedValue([]);
});

describe("Socket root connection admission and registration", () => {
  it("disconnects a socket without trusted user state before registry or handler work", async () => {
    const runtime = makeRuntime();
    const addSpy = vi.spyOn(runtime.registry, "add");
    const client = runtime.makeSocket(null);

    await runtime.runConnection(client.socket as unknown as Socket);

    expect(client.socket.disconnect).toHaveBeenCalledWith(true);
    expect(addSpy).not.toHaveBeenCalled();
    expect(client.socket.on).not.toHaveBeenCalled();
    expect(client.socket.emit).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.chatMembers.findMany).not.toHaveBeenCalled();
    expect(registerWebRtcHandlers).not.toHaveBeenCalled();
  });

  it("preserves first-connection presence, online-list, room, handler, and WebRTC ordering", async () => {
    const runtime = makeRuntime();
    runtime.registry.add(OTHER_USER_ID, "other-socket");
    vi.mocked(prisma.chatMembers.findMany).mockResolvedValue([
      { chatId: CHAT_A },
      { chatId: CHAT_B },
    ] as never);
    const client = runtime.makeSocket();

    await runtime.runConnection(client.socket as unknown as Socket);

    expect(client.socket.on.mock.calls.map(([event]) => event)).toEqual(expectedRootRegistrations);
    expect(new Set(client.socket.on.mock.calls.map(([event]) => event)).size).toBe(expectedRootRegistrations.length);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { isOnline: true },
    });
    expect(client.broadcastEmit).toHaveBeenCalledWith(Events.ONLINE_USER, { userId: USER_ID });
    expect(client.socket.emit).toHaveBeenCalledWith(Events.ONLINE_USERS_LIST, {
      onlineUserIds: [OTHER_USER_ID, USER_ID],
    });
    expect(prisma.chatMembers.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      select: { chatId: true },
    });
    expect(client.socket.join).toHaveBeenCalledWith([CHAT_A, CHAT_B]);
    expect(registerWebRtcHandlers).toHaveBeenCalledWith(
      client.socket,
      runtime.io,
      { directory: runtime.directory, limiter: runtime.limiter },
    );

    expect(client.socket.on.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.user.update).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(prisma.user.update).mock.invocationCallOrder[0]).toBeLessThan(
      client.broadcastEmit.mock.invocationCallOrder[0],
    );
    expect(client.broadcastEmit.mock.invocationCallOrder[0]).toBeLessThan(
      client.socket.emit.mock.invocationCallOrder[0],
    );
    expect(client.socket.emit.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.chatMembers.findMany).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(prisma.chatMembers.findMany).mock.invocationCallOrder[0]).toBeLessThan(
      client.socket.join.mock.invocationCallOrder[0],
    );
    expect(client.socket.join.mock.invocationCallOrder[0]).toBeLessThan(
      client.socket.on.mock.invocationCallOrder[1],
    );
    expect(client.socket.on.mock.invocationCallOrder.at(-1)).toBeLessThan(
      vi.mocked(registerWebRtcHandlers).mock.invocationCallOrder[0],
    );
  });

  it("logs an online presence failure safely and continues root initialization", async () => {
    const privateFailure = new Error("private online database detail");
    vi.mocked(prisma.user.update).mockRejectedValueOnce(privateFailure);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runtime = makeRuntime();
    const client = runtime.makeSocket();

    await runtime.runConnection(client.socket as unknown as Socket);

    expect(errorSpy).toHaveBeenCalledWith(
      "Socket online presence update failed.",
      { errorType: "Error" },
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(privateFailure.message);
    expect(client.broadcastEmit).toHaveBeenCalledWith(Events.ONLINE_USER, { userId: USER_ID });
    expect(client.socket.emit).toHaveBeenCalledWith(Events.ONLINE_USERS_LIST, {
      onlineUserIds: [USER_ID],
    });
    expect(client.socket.join).toHaveBeenCalledWith([]);
    expect(registerWebRtcHandlers).toHaveBeenCalledTimes(1);
  });

  it("logs room lookup failure safely and still installs all event families and WebRTC", async () => {
    const privateFailure = new Error("private room database detail");
    vi.mocked(prisma.chatMembers.findMany).mockRejectedValueOnce(privateFailure);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runtime = makeRuntime();
    const client = runtime.makeSocket();

    await runtime.runConnection(client.socket as unknown as Socket);

    expect(errorSpy).toHaveBeenCalledWith(
      "Socket room initialization failed.",
      { errorType: "Error" },
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(privateFailure.message);
    expect(client.socket.join).not.toHaveBeenCalled();
    expect(client.socket.on.mock.calls.map(([event]) => event)).toEqual(expectedRootRegistrations);
    expect(registerWebRtcHandlers).toHaveBeenCalledWith(
      client.socket,
      runtime.io,
      { directory: runtime.directory, limiter: runtime.limiter },
    );
  });

  it("logs a final-disconnect presence failure and still broadcasts the registry transition", async () => {
    vi.mocked(prisma.user.update)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error("private offline database detail"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runtime = makeRuntime();
    const client = runtime.makeSocket();
    await runtime.runConnection(client.socket as unknown as Socket);

    const disconnectHandler = client.handlers.get("disconnect");
    expect(disconnectHandler).toBeDefined();
    await disconnectHandler!();

    expect(prisma.user.update).toHaveBeenLastCalledWith({
      where: { id: USER_ID },
      data: { isOnline: false, lastSeen: expect.any(Date) },
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Socket offline presence update failed.",
      { errorType: "Error" },
    );
    expect(client.broadcastEmit).toHaveBeenCalledWith(Events.OFFLINE_USER, { userId: USER_ID });
    expect(runtime.registry.isOnline(USER_ID)).toBe(false);
  });
});
