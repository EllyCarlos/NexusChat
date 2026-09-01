import type { Server, Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRealtime: vi.fn(() => ({ marker: "realtime" })),
  registerMessageHandlers: vi.fn(),
  registerMessageLifecycleHandlers: vi.fn(),
  registerReactionHandlers: vi.fn(),
  registerTypingHandlers: vi.fn(),
  registerPollHandlers: vi.fn(),
  registerPinHandlers: vi.fn(),
  registerWebRtcHandlers: vi.fn(),
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    user: { update: vi.fn() },
    chatMembers: { findMany: vi.fn() },
  },
}));

vi.mock("../src/socket/handlers/message.handlers.js", () => ({
  registerMessageHandlers: mocks.registerMessageHandlers,
}));

vi.mock("../src/socket/handlers/message-lifecycle.handlers.js", () => ({
  registerMessageLifecycleHandlers: mocks.registerMessageLifecycleHandlers,
}));

vi.mock("../src/socket/handlers/reaction.handlers.js", () => ({
  registerReactionHandlers: mocks.registerReactionHandlers,
}));

vi.mock("../src/socket/handlers/typing.handlers.js", () => ({
  registerTypingHandlers: mocks.registerTypingHandlers,
}));

vi.mock("../src/socket/handlers/poll.handlers.js", () => ({
  registerPollHandlers: mocks.registerPollHandlers,
}));

vi.mock("../src/socket/handlers/pin.handlers.js", () => ({
  registerPinHandlers: mocks.registerPinHandlers,
}));

vi.mock("../src/socket/realtime/infrastructure/socket-chat-event-realtime.adapter.js", () => ({
  createSocketChatEventRealtimeAdapter: mocks.createRealtime,
}));

vi.mock("../src/socket/webrtc/socket.js", () => ({
  default: mocks.registerWebRtcHandlers,
}));

import { Events } from "../src/enums/event/event.enum.js";
import { prisma } from "../src/lib/prisma.lib.js";
import type {
  DirectoryConnectionRegistration,
  DirectoryConnectionRemoval,
  SocketConnectionDirectory,
  SocketPresenceTransition,
} from "../src/socket/connection-directory.js";
import { SocketConnectionRegistry } from "../src/socket/connection-registry.js";
import registerSocketHandlers from "../src/socket/socket.js";
import type { SocketPresenceCoordinator } from "../src/socket/socket-presence.coordinator.js";
import { createCapturingLogger } from "./support/capturing-logger.js";

const USER_ID = "cm2d300000000000000000001";
const REMOTE_USER_ID = "cm2d300000000000000000002";
const SOCKET_ID = "socket-phase-2d3";
const CHAT_ID = "cm2d300000000000000000003";

type Deferred<Value> = {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(error: unknown): void;
};

const deferred = <Value>(): Deferred<Value> => {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const onlineTransition = (socketId = SOCKET_ID): SocketPresenceTransition => ({
  userId: USER_ID,
  state: "online",
  version: 1,
  sourceSocketId: socketId,
});

const offlineTransition = (socketId = SOCKET_ID): SocketPresenceTransition => ({
  userId: USER_ID,
  state: "offline",
  version: 2,
  sourceSocketId: socketId,
});

const acceptedRegistration = (
  presenceTransition?: SocketPresenceTransition,
): DirectoryConnectionRegistration => ({
  accepted: true,
  firstConnection: presenceTransition?.state === "online",
  ...(presenceTransition ? { presenceTransition } : {}),
});

const removal = (
  removed: boolean,
  lastConnection: boolean,
  presenceTransition?: SocketPresenceTransition,
): DirectoryConnectionRemoval => ({
  removed,
  lastConnection,
  ...(presenceTransition ? { presenceTransition } : {}),
});

const createDirectory = (
  overrides: Partial<SocketConnectionDirectory> = {},
): SocketConnectionDirectory => ({
  add: vi.fn(async () => acceptedRegistration()),
  remove: vi.fn(async () => removal(true, false)),
  getSockets: vi.fn(async () => []),
  getLatestSocket: vi.fn(async () => undefined),
  isOnline: vi.fn(async () => true),
  connectionCount: vi.fn(async () => 1),
  onlineUserIds: vi.fn(async () => [REMOTE_USER_ID, USER_ID]),
  ...overrides,
});

const createPresence = (
  overrides: Partial<SocketPresenceCoordinator> = {},
): SocketPresenceCoordinator => ({
  reconcileTransition: vi.fn(async () => undefined),
  reconcileUser: vi.fn(async () => undefined),
  reconcilePending: vi.fn(async () => 0),
  drain: vi.fn(async () => undefined),
  ...overrides,
});

type SocketEventHandler = (...arguments_: unknown[]) => unknown;

const createHarness = ({
  directory = createDirectory(),
  presence = createPresence(),
  registry,
}: {
  directory?: SocketConnectionDirectory;
  presence?: SocketPresenceCoordinator;
  registry?: SocketConnectionRegistry;
} = {}) => {
  const logger = createCapturingLogger("socket");
  let connectionHandler: ((socket: Socket) => Promise<unknown>) | undefined;
  const localRoomDisconnect = vi.fn();
  const globalRoomDisconnect = vi.fn();
  const globalIn = vi.fn(() => ({ disconnectSockets: globalRoomDisconnect }));
  const io = {
    on: vi.fn((event: string, handler: (socket: Socket) => Promise<unknown>) => {
      expect(event).toBe("connection");
      connectionHandler = handler;
      return io;
    }),
    emit: vi.fn(),
    to: vi.fn(() => ({ emit: vi.fn() })),
    in: globalIn,
    except: vi.fn(() => ({ emit: vi.fn() })),
    disconnectSockets: vi.fn(),
    local: {
      disconnectSockets: vi.fn(),
      in: vi.fn(() => ({ disconnectSockets: localRoomDisconnect })),
    },
  };
  const lifecycle = registerSocketHandlers(io as unknown as Server, {
    directory,
    presence,
    logger,
    ...(registry ? { registry } : {}),
  });

  const handlers = new Map<string, SocketEventHandler>();
  const socket = {
    id: SOCKET_ID,
    user: { id: USER_ID, username: "phase-2d3", avatar: "avatar" },
    on: vi.fn((event: string, handler: SocketEventHandler) => {
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

  return {
    directory,
    globalIn,
    globalRoomDisconnect,
    handlers,
    io,
    lifecycle,
    logger,
    localRoomDisconnect,
    presence,
    runConnection: () => {
      expect(connectionHandler).toBeDefined();
      return connectionHandler!(socket as unknown as Socket);
    },
    socket,
  };
};

const ordinaryRegistrations = () => [
  mocks.registerMessageHandlers,
  mocks.registerMessageLifecycleHandlers,
  mocks.registerReactionHandlers,
  mocks.registerTypingHandlers,
  mocks.registerPollHandlers,
  mocks.registerPinHandlers,
  mocks.registerWebRtcHandlers,
];

const expectNoOrdinaryInitialization = (
  harness: ReturnType<typeof createHarness>,
) => {
  expect(prisma.chatMembers.findMany).not.toHaveBeenCalled();
  expect(harness.socket.join).not.toHaveBeenCalled();
  expect(mocks.createRealtime).not.toHaveBeenCalled();
  for (const registration of ordinaryRegistrations()) {
    expect(registration).not.toHaveBeenCalled();
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.chatMembers.findMany).mockResolvedValue([{ chatId: CHAT_ID }] as never);
});

describe("Phase 2D-3 Socket root directory admission", () => {
  it("awaits admission and the global online list before rooms and ordinary handlers", async () => {
    const addResult = deferred<DirectoryConnectionRegistration>();
    const onlineResult = deferred<string[]>();
    const directory = createDirectory({
      add: vi.fn(() => addResult.promise),
      onlineUserIds: vi.fn(() => onlineResult.promise),
    });
    const harness = createHarness({ directory });

    const connection = harness.runConnection();
    await vi.waitFor(() => expect(directory.add).toHaveBeenCalledWith(USER_ID, SOCKET_ID));

    expect(directory.onlineUserIds).not.toHaveBeenCalled();
    expectNoOrdinaryInitialization(harness);

    addResult.resolve(acceptedRegistration());
    await vi.waitFor(() => expect(directory.onlineUserIds).toHaveBeenCalledTimes(1));

    expect(prisma.chatMembers.findMany).not.toHaveBeenCalled();
    expectNoOrdinaryInitialization(harness);

    onlineResult.resolve([REMOTE_USER_ID, USER_ID]);
    await connection;

    expect(harness.socket.emit).toHaveBeenCalledWith(Events.ONLINE_USERS_LIST, {
      onlineUserIds: [REMOTE_USER_ID, USER_ID],
    });
    expect(prisma.chatMembers.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      select: { chatId: true },
    });
    expect(harness.socket.join).toHaveBeenCalledWith([CHAT_ID]);
    for (const registration of ordinaryRegistrations()) {
      expect(registration).toHaveBeenCalledTimes(1);
    }

    expect(vi.mocked(directory.add).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(directory.onlineUserIds).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(directory.onlineUserIds).mock.invocationCallOrder[0]).toBeLessThan(
      harness.socket.emit.mock.invocationCallOrder[0],
    );
    expect(harness.socket.emit.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.chatMembers.findMany).mock.invocationCallOrder[0],
    );
    expect(harness.socket.join.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.registerMessageHandlers.mock.invocationCallOrder[0],
    );
  });

  it("rejects a global connection-cap result with the exact security error", async () => {
    const directory = createDirectory({
      add: vi.fn(async () => ({ accepted: false, firstConnection: false })),
    });
    const harness = createHarness({ directory });

    await harness.runConnection();

    expect(harness.socket.emit).toHaveBeenCalledWith(Events.SECURITY_ERROR, {
      category: "CONNECTION_LIMIT",
      event: "connection",
    });
    expect(harness.socket.disconnect).toHaveBeenCalledWith(true);
    expect(directory.onlineUserIds).not.toHaveBeenCalled();
    expect(directory.remove).not.toHaveBeenCalled();
    expect(harness.presence.reconcileTransition).not.toHaveBeenCalled();
    expectNoOrdinaryInitialization(harness);
  });

  it("safe-logs directory admission failure and fails closed", async () => {
    const privateFailure = new Error("redis://user:private-admission-secret@example.test");
    const directory = createDirectory({
      add: vi.fn(async () => Promise.reject(privateFailure)),
    });
    const harness = createHarness({ directory });

    await harness.runConnection();

    expect(harness.logger.events).toContainEqual({
      level: "error",
      component: "socket",
      event: "socket.connection_registration.failed",
      fields: { errorType: "Error" },
    });
    expect(JSON.stringify(harness.logger.events)).not.toContain(privateFailure.message);
    expect(harness.socket.disconnect).toHaveBeenCalledWith(true);
    expect(directory.onlineUserIds).not.toHaveBeenCalled();
    expectNoOrdinaryInitialization(harness);
  });

  it("removes an accepted registration when disconnect arrives while add is pending", async () => {
    const addResult = deferred<DirectoryConnectionRegistration>();
    const directory = createDirectory({
      add: vi.fn(() => addResult.promise),
      remove: vi.fn(async () => removal(true, true, offlineTransition())),
    });
    const presence = createPresence();
    const harness = createHarness({ directory, presence });

    const connection = harness.runConnection();
    await vi.waitFor(() => expect(harness.handlers.get("disconnect")).toBeTypeOf("function"));
    await harness.handlers.get("disconnect")!();

    expect(directory.remove).not.toHaveBeenCalled();
    addResult.resolve(acceptedRegistration(onlineTransition()));
    await connection;

    expect(directory.remove).toHaveBeenCalledOnce();
    expect(directory.remove).toHaveBeenCalledWith(USER_ID, SOCKET_ID);
    expect(presence.reconcileTransition).toHaveBeenCalledOnce();
    expect(presence.reconcileTransition).toHaveBeenCalledWith(offlineTransition());
    expect(presence.reconcileTransition).not.toHaveBeenCalledWith(onlineTransition());
    expect(directory.onlineUserIds).not.toHaveBeenCalled();
    expectNoOrdinaryInitialization(harness);
  });

  it("rejects new admission after the lifecycle enters drain mode", async () => {
    const harness = createHarness();

    harness.lifecycle.beginDrain();
    expect(harness.lifecycle.isAcceptingConnections).toBe(false);
    await harness.runConnection();

    expect(harness.socket.disconnect).toHaveBeenCalledWith(true);
    expect(harness.directory.add).not.toHaveBeenCalled();
    expect(harness.socket.on).not.toHaveBeenCalled();
    expectNoOrdinaryInitialization(harness);
  });

  it.each([
    ["non-final", removal(true, false)],
    ["unknown", removal(false, false)],
  ])("does not reconcile presence for a %s removal", async (_label, removeResult) => {
    const directory = createDirectory({
      remove: vi.fn(async () => removeResult),
    });
    const presence = createPresence();
    const harness = createHarness({ directory, presence });
    await harness.runConnection();

    await harness.handlers.get("disconnect")!();

    expect(directory.remove).toHaveBeenCalledWith(USER_ID, SOCKET_ID);
    expect(presence.reconcileTransition).not.toHaveBeenCalled();
  });

  it("reconciles the exact final-removal transition", async () => {
    const transition = offlineTransition();
    const directory = createDirectory({
      remove: vi.fn(async () => removal(true, true, transition)),
    });
    const presence = createPresence();
    const harness = createHarness({ directory, presence });
    await harness.runConnection();

    await harness.handlers.get("disconnect")!();

    expect(presence.reconcileTransition).toHaveBeenCalledOnce();
    expect(presence.reconcileTransition).toHaveBeenCalledWith(transition);
  });

  it("safe-logs removal failure without falling back to the process-local registry", async () => {
    const privateFailure = new Error("private distributed removal detail");
    const localRegistry = new SocketConnectionRegistry();
    const localRemove = vi.spyOn(localRegistry, "remove");
    const directory = createDirectory({
      remove: vi.fn(async () => Promise.reject(privateFailure)),
    });
    const presence = createPresence();
    const harness = createHarness({ directory, presence, registry: localRegistry });
    await harness.runConnection();

    await harness.handlers.get("disconnect")!();

    expect(harness.logger.events).toContainEqual({
      level: "error",
      component: "socket",
      event: "socket.connection_removal.failed",
      fields: { errorType: "Error" },
    });
    expect(JSON.stringify(harness.logger.events)).not.toContain(privateFailure.message);
    expect(directory.remove).toHaveBeenCalledOnce();
    expect(localRemove).not.toHaveBeenCalled();
    expect(presence.reconcileTransition).not.toHaveBeenCalled();
  });

  it("removes and disconnects when the global online-user lookup fails", async () => {
    const privateFailure = new Error("private global-list detail");
    const directory = createDirectory({
      onlineUserIds: vi.fn(async () => Promise.reject(privateFailure)),
      remove: vi.fn(async () => removal(true, false)),
    });
    const harness = createHarness({ directory });

    await harness.runConnection();

    expect(harness.logger.events).toContainEqual({
      level: "error",
      component: "socket",
      event: "socket.online_users_lookup.failed",
      fields: { errorType: "Error" },
    });
    expect(JSON.stringify(harness.logger.events)).not.toContain(privateFailure.message);
    expect(directory.remove).toHaveBeenCalledWith(USER_ID, SOCKET_ID);
    expect(harness.socket.disconnect).toHaveBeenCalledWith(true);
    expect(harness.socket.emit).not.toHaveBeenCalledWith(
      Events.ONLINE_USERS_LIST,
      expect.anything(),
    );
    expectNoOrdinaryInitialization(harness);
  });
});

describe("Phase 2D-3 Socket root drain lifecycle", () => {
  it("disconnects only local sockets and drains pending removal reconciliation", async () => {
    const reconciliation = deferred<void>();
    const directory = createDirectory({
      remove: vi.fn(async () => removal(true, true, offlineTransition())),
    });
    const presence = createPresence({
      reconcileTransition: vi.fn(() => reconciliation.promise),
    });
    const harness = createHarness({ directory, presence });
    await harness.runConnection();

    const disconnectWork = Promise.resolve(harness.handlers.get("disconnect")!());
    await vi.waitFor(() => expect(presence.reconcileTransition).toHaveBeenCalledOnce());

    harness.lifecycle.beginDrain();
    harness.lifecycle.disconnectLocalSockets();
    let drainSettled = false;
    const drainWork = harness.lifecycle.drain().then(() => {
      drainSettled = true;
    });
    await Promise.resolve();

    expect(harness.io.local.disconnectSockets).toHaveBeenCalledOnce();
    expect(harness.io.local.disconnectSockets).toHaveBeenCalledWith(true);
    expect(harness.io.disconnectSockets).not.toHaveBeenCalled();
    expect(harness.globalIn).not.toHaveBeenCalled();
    expect(drainSettled).toBe(false);
    expect(presence.drain).not.toHaveBeenCalled();

    reconciliation.resolve(undefined);
    await Promise.all([disconnectWork, drainWork]);

    expect(presence.drain).toHaveBeenCalledOnce();
    expect(drainSettled).toBe(true);
  });

  it("disconnects a lost lease through the local Socket.IO scope only", () => {
    const harness = createHarness();

    harness.lifecycle.handleLostConnection(USER_ID, "lost-socket-id");

    expect(harness.io.local.in).toHaveBeenCalledOnce();
    expect(harness.io.local.in).toHaveBeenCalledWith("lost-socket-id");
    expect(harness.localRoomDisconnect).toHaveBeenCalledOnce();
    expect(harness.localRoomDisconnect).toHaveBeenCalledWith(true);
    expect(harness.globalIn).not.toHaveBeenCalled();
    expect(harness.globalRoomDisconnect).not.toHaveBeenCalled();
    expect(harness.io.disconnectSockets).not.toHaveBeenCalled();
  });
});
