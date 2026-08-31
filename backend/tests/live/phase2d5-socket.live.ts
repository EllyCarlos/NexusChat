import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

import { Server as SocketServer, type Socket } from "socket.io";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prepareSocketTransport } from "../../src/infrastructure/redis/socket-io-redis-adapter.js";
import {
  createSocketConnectionStateRuntime,
  type SocketConnectionStateRuntime,
} from "../../src/infrastructure/redis/socket-connection-state.runtime.js";
import {
  createRedisClient,
  type NodeRedisClient,
} from "../../src/infrastructure/redis/redis-client.js";
import {
  createRedisRuntime,
  type RedisRuntime,
} from "../../src/infrastructure/redis/redis-runtime.js";
import { SOCKET_CONNECTION_REDIS_KEYS } from "../../src/infrastructure/redis/socket-connection-scripts.js";
import { SOCKET_EVENT_RATE_LIMIT_REDIS_KEY_PREFIX } from "../../src/infrastructure/redis/socket-event-rate-limit-script.js";
import { createRegistryCallPeerLocator } from "../../src/modules/calls/infrastructure/registry-call-peer-locator.adapter.js";
import { Events } from "../../src/enums/event/event.enum.js";
import { createSocketEventRateLimitBucketIdentity } from "../../src/socket/socket-event-rate-limit.port.js";
import {
  enforceSocketEventLimits,
  SOCKET_EVENT_LIMITS,
} from "../../src/socket/socket-security.js";
import {
  disconnectMembersFromChatRoom,
  joinMembersInChatRoom,
} from "../../src/utils/chat.util.js";
import { emitEvent } from "../../src/utils/socket.util.js";

const redisUrl = process.env.NEXUSCHAT_LIVE_REDIS_URL;
const disposableAcknowledged =
  process.env.NEXUSCHAT_LIVE_REDIS_DISPOSABLE === "true";

if (!redisUrl || !disposableAcknowledged) {
  throw new Error(
    "Live Socket.IO tests require NEXUSCHAT_LIVE_REDIS_URL and "
      + "NEXUSCHAT_LIVE_REDIS_DISPOSABLE=true.",
  );
}

const parsedRedisUrl = new URL(redisUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(parsedRedisUrl.hostname)) {
  throw new Error("Phase 2D-5 live tests require a disposable local Redis.");
}

const RUN_ID = randomUUID().replaceAll("-", "");
const TEST_PREFIX = `nexuschat-2d5-socket-${RUN_ID}`;
const SHARED_ROOM = `${TEST_PREFIX}-shared-room`;
const REMOTE_ROOM = `${TEST_PREFIX}-remote-room`;
const BROADCAST_EVENT = `${TEST_PREFIX}:broadcast`;
const DIRECT_EVENT = `${TEST_PREFIX}:direct`;
const REMOTE_ROOM_EVENT = `${TEST_PREFIX}:remote-room`;
const LIMITED_EVENT = `${TEST_PREFIX}:limited`;
const LIMITED_ACCEPTED_EVENT = `${TEST_PREFIX}:limited:accepted`;

type ReceivedEvent = {
  event: string;
  payload: unknown;
};

class LiveWebSocketClient {
  readonly transport = "websocket";
  readonly socketId: string;
  private readonly received: ReceivedEvent[] = [];
  private readonly waiters = new Set<{
    events: Set<string>;
    resolve: (packet: ReceivedEvent) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  private constructor(
    private readonly websocket: WebSocket,
    socketId: string,
  ) {
    this.socketId = socketId;
  }

  static connect(origin: string): Promise<LiveWebSocketClient> {
    return new Promise((resolve, reject) => {
      const websocket = new WebSocket(
        `${origin.replace("http", "ws")}/socket.io/?EIO=4&transport=websocket`,
      );
      let settled = false;
      const connectionTimeout = setTimeout(() => {
        websocket.close();
        reject(new Error("Timed out connecting live Socket.IO WebSocket client."));
      }, 4_000);

      websocket.addEventListener("error", () => {
        if (!settled) {
          settled = true;
          clearTimeout(connectionTimeout);
          websocket.close();
          reject(new Error("Live Socket.IO WebSocket failed."));
        }
      });
      websocket.addEventListener("message", (message) => {
        const payload = String(message.data);
        for (const packet of payload.split("\u001e")) {
          if (packet.startsWith("0")) {
            websocket.send("40");
            continue;
          }
          if (packet === "2") {
            websocket.send("3");
            continue;
          }
          if (!packet.startsWith("40")) continue;
          const connected = JSON.parse(packet.slice(2)) as { sid: string };
          settled = true;
          clearTimeout(connectionTimeout);
          const client = new LiveWebSocketClient(websocket, connected.sid);
          websocket.addEventListener("message", (nextMessage) => {
            client.handlePayload(String(nextMessage.data));
          });
          resolve(client);
        }
      });
    });
  }

  emit(event: string, payload: unknown): void {
    this.websocket.send(`42${JSON.stringify([event, payload])}`);
  }

  waitForEvent(
    events: string | readonly string[],
    timeoutMilliseconds = 2_000,
  ): Promise<ReceivedEvent> {
    const acceptedEvents = new Set(
      typeof events === "string" ? [events] : events,
    );
    const existingIndex = this.received.findIndex((packet) =>
      acceptedEvents.has(packet.event));
    if (existingIndex >= 0) {
      return Promise.resolve(this.received.splice(existingIndex, 1)[0]);
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        events: acceptedEvents,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error("Timed out waiting for live Socket.IO event."));
        }, timeoutMilliseconds),
      };
      this.waiters.add(waiter);
    });
  }

  close(): void {
    if (this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send("41");
      this.websocket.close();
    }
  }

  private handlePayload(payload: string): void {
    for (const packet of payload.split("\u001e")) {
      if (packet === "2") {
        this.websocket.send("3");
        continue;
      }
      if (!packet.startsWith("42")) continue;
      const decoded = JSON.parse(packet.slice(2)) as [string, unknown];
      const received = { event: decoded[0], payload: decoded[1] };
      const waiter = [...this.waiters].find((candidate) =>
        candidate.events.has(received.event));
      if (!waiter) {
        this.received.push(received);
        continue;
      }
      clearTimeout(waiter.timeout);
      this.waiters.delete(waiter);
      waiter.resolve(received);
    }
  }
}

class LivePollingClient {
  readonly transport = "polling";
  readonly socketId: string;
  private constructor(
    private readonly origin: string,
    private readonly engineId: string,
    socketId: string,
  ) {
    this.socketId = socketId;
  }

  static async connect(origin: string): Promise<LivePollingClient> {
    const initial = await fetch(
      `${origin}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`,
    );
    expect(initial.ok).toBe(true);
    const initialPayload = await initial.text();
    const openPacket = initialPayload.split("\u001e").find((packet) =>
      packet.startsWith("0"));
    if (!openPacket) throw new Error("Missing Engine.IO polling open packet.");
    const open = JSON.parse(openPacket.slice(1)) as { sid: string };
    const sessionUrl = `${origin}/socket.io/?EIO=4&transport=polling&sid=${
      encodeURIComponent(open.sid)
    }`;
    const connected = await fetch(sessionUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: "40",
    });
    expect(connected.ok).toBe(true);
    const response = await fetch(`${sessionUrl}&t=${Date.now()}`);
    const packets = (await response.text()).split("\u001e");
    const socketPacket = packets.find((packet) => packet.startsWith("40"));
    if (!socketPacket) throw new Error("Missing Socket.IO polling connect packet.");
    const socketConnection = JSON.parse(socketPacket.slice(2)) as { sid: string };
    return new LivePollingClient(origin, open.sid, socketConnection.sid);
  }

  async waitForEvent(
    event: string,
    timeoutMilliseconds = 2_000,
  ): Promise<ReceivedEvent> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
    const sessionUrl = `${this.origin}/socket.io/?EIO=4&transport=polling&sid=${
      encodeURIComponent(this.engineId)
    }&t=${Date.now()}`;
    try {
      const response = await fetch(sessionUrl, { signal: controller.signal });
      const packets = (await response.text()).split("\u001e");
      const eventPacket = packets.find((packet) => packet.startsWith("42"));
      if (!eventPacket) throw new Error("Missing polling Socket.IO event packet.");
      const decoded = JSON.parse(eventPacket.slice(2)) as [string, unknown];
      expect(decoded[0]).toBe(event);
      return { event: decoded[0], payload: decoded[1] };
    } finally {
      clearTimeout(timeout);
    }
  }

  async close(): Promise<void> {
    const sessionUrl = `${this.origin}/socket.io/?EIO=4&transport=polling&sid=${
      encodeURIComponent(this.engineId)
    }`;
    await fetch(sessionUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: "41",
    }).catch(() => undefined);
  }
}

type LiveNode = {
  httpServer: HttpServer;
  io: SocketServer;
  port: number;
  state: SocketConnectionStateRuntime;
  transport: Awaited<ReturnType<typeof prepareSocketTransport>>;
};

const listen = (server: HttpServer): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });

const waitFor = async (
  predicate: () => Promise<boolean> | boolean,
  timeoutMilliseconds = 4_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for live distributed Socket.IO state.");
};

const createLiveNode = async (): Promise<LiveNode> => {
  const httpServer = createServer();
  const io = new SocketServer(httpServer, {
    transports: ["polling", "websocket"],
  });
  const state = createSocketConnectionStateRuntime({
    mode: { kind: "distributed", redisUrl },
  });
  let transport: Awaited<ReturnType<typeof prepareSocketTransport>> | undefined;
  try {
    transport = await prepareSocketTransport({
      io,
      mode: { kind: "distributed", redisUrl },
    });
    await state.connect();
    await state.start({
      handleLostConnection: () => undefined,
      reconcilePresence: async () => undefined,
    });

    io.on("connection", (socket: Socket) => {
      socket.join(SHARED_ROOM);
      socket.on(LIMITED_EVENT, async () => {
        const allowed = await enforceSocketEventLimits({
          socket,
          event: LIMITED_EVENT,
          limiter: state.eventLimiter,
          policies: [SOCKET_EVENT_LIMITS.pinMessage],
          keyParts: [`${TEST_PREFIX}-actor`, `${TEST_PREFIX}-resource`],
        });
        if (allowed) socket.emit(LIMITED_ACCEPTED_EVENT, { accepted: true });
      });
    });

    return {
      httpServer,
      io,
      port: await listen(httpServer),
      state,
      transport,
    };
  } catch (error) {
    state.markDraining();
    await new Promise<void>((resolveClose) => io.close(() => resolveClose()));
    await Promise.allSettled([state.close(), transport?.close()]);
    throw error;
  }
};

const closeLiveNode = async (node: LiveNode): Promise<void> => {
  const failures: unknown[] = [];
  node.state.markDraining();
  for (const operation of [
    () => new Promise<void>((resolveClose) => node.io.close(() => resolveClose())),
    () => node.state.close(),
    () => node.transport.close(),
  ]) {
    try {
      await operation();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new Error("Live Socket.IO node shutdown failed.");
  }
};

const clientCount = async (inspector: NodeRedisClient): Promise<number> => {
  const response = await inspector.sendCommand(["CLIENT", "LIST"]);
  return String(response).split(/\r?\n/u).filter(Boolean).length;
};

const removeTestState = async (
  inspector: NodeRedisClient,
  users: readonly string[],
  sockets: readonly string[],
): Promise<void> => {
  const connectionKeys = users.flatMap((userId) => sockets.map((socketId) =>
    `${Buffer.from(userId).toString("base64url")}.${Buffer.from(socketId).toString("base64url")}`));
  if (users.length > 0) {
    await inspector.sendCommand([
      "HDEL",
      SOCKET_CONNECTION_REDIS_KEYS.connections,
      ...users,
    ]);
    await inspector.sendCommand([
      "ZREM",
      SOCKET_CONNECTION_REDIS_KEYS.onlineUsers,
      ...users,
    ]);
    await inspector.sendCommand([
      "HDEL",
      SOCKET_CONNECTION_REDIS_KEYS.presenceCurrent,
      ...users,
    ]);
    await inspector.sendCommand([
      "ZREM",
      SOCKET_CONNECTION_REDIS_KEYS.presencePending,
      ...users,
    ]);
    await inspector.sendCommand([
      "HDEL",
      SOCKET_CONNECTION_REDIS_KEYS.presenceClaims,
      ...users,
    ]);
    await inspector.sendCommand([
      "ZREM",
      SOCKET_CONNECTION_REDIS_KEYS.presenceCleanup,
      ...users,
    ]);
  }
  if (connectionKeys.length > 0) {
    await inspector.sendCommand([
      "ZREM",
      SOCKET_CONNECTION_REDIS_KEYS.leases,
      ...connectionKeys,
    ]);
    await inspector.sendCommand([
      "HDEL",
      SOCKET_CONNECTION_REDIS_KEYS.owners,
      ...connectionKeys,
    ]);
  }

  const policyKey = `${SOCKET_EVENT_RATE_LIMIT_REDIS_KEY_PREFIX}${
    createSocketEventRateLimitBucketIdentity(
      SOCKET_EVENT_LIMITS.pinMessage,
      [`${TEST_PREFIX}-actor`, `${TEST_PREFIX}-resource`],
    )
  }`;
  await inspector.del(policyKey);
};

let inspector: NodeRedisClient;
let inspectorRuntime: RedisRuntime<NodeRedisClient>;

beforeAll(async () => {
  inspector = createRedisClient({ url: redisUrl });
  inspectorRuntime = createRedisRuntime(inspector);
  await inspectorRuntime.connect();
});

afterAll(async () => {
  await inspectorRuntime.close();
});

describe("Phase 2D-5 two-node Socket.IO Redis transport", () => {
  it("certifies cross-node delivery, remote rooms, global directory, limiter, transports, and client ownership", async () => {
    const baselineClients = await clientCount(inspector);
    const nodes: LiveNode[] = [];
    const clients: LiveWebSocketClient[] = [];
    const userA = `${TEST_PREFIX}-user-a`;
    const userB = `${TEST_PREFIX}-user-b`;
    const sharedUser = `${TEST_PREFIX}-shared-user`;
    const users = [userA, userB, sharedUser];
    let sockets: string[] = [];

    try {
      const nodeA = await createLiveNode();
      nodes.push(nodeA);
      expect(await clientCount(inspector)).toBe(baselineClients + 3);
      const nodeB = await createLiveNode();
      nodes.push(nodeB);
      expect(await clientCount(inspector)).toBe(baselineClients + 6);

      const clientA = await LiveWebSocketClient.connect(
        `http://127.0.0.1:${nodeA.port}`,
      );
      clients.push(clientA);
      const clientB = await LiveWebSocketClient.connect(
        `http://127.0.0.1:${nodeB.port}`,
      );
      clients.push(clientB);
      sockets = [clientA.socketId, clientB.socketId];

      await nodeA.state.directory.add(userA, clientA.socketId);
      await nodeB.state.directory.add(userB, clientB.socketId);
      await nodeA.state.directory.add(sharedUser, clientA.socketId);
      await nodeB.state.directory.add(sharedUser, clientB.socketId);

      expect(await nodeA.state.directory.getSockets(sharedUser)).toEqual(sockets);
      expect(await nodeB.state.directory.getSockets(sharedUser)).toEqual(sockets);
      expect(await nodeA.state.directory.connectionCount(sharedUser)).toBe(2);
      expect(await nodeB.state.directory.isOnline(sharedUser)).toBe(true);

      const peerLocator = createRegistryCallPeerLocator(nodeA.state.directory);
      expect(await peerLocator.getLatestSocketId(sharedUser)).toBe(clientB.socketId);
      await nodeB.state.directory.remove(sharedUser, clientB.socketId);
      expect(await peerLocator.getLatestSocketId(sharedUser)).toBe(clientA.socketId);
      await nodeB.state.directory.add(sharedUser, clientB.socketId);
      expect(await peerLocator.getLatestSocketId(sharedUser)).toBe(clientB.socketId);

      const firstBroadcastToA = clientA.waitForEvent(BROADCAST_EVENT);
      const firstBroadcastToB = clientB.waitForEvent(BROADCAST_EVENT);
      nodeA.io.to(SHARED_ROOM).emit(BROADCAST_EVENT, { from: "A" });
      expect((await firstBroadcastToA).payload).toEqual({ from: "A" });
      expect((await firstBroadcastToB).payload).toEqual({ from: "A" });
      const secondBroadcastToA = clientA.waitForEvent(BROADCAST_EVENT);
      const secondBroadcastToB = clientB.waitForEvent(BROADCAST_EVENT);
      nodeB.io.to(SHARED_ROOM).emit(BROADCAST_EVENT, { from: "B" });
      expect((await secondBroadcastToA).payload).toEqual({ from: "B" });
      expect((await secondBroadcastToB).payload).toEqual({ from: "B" });

      const directToB = clientB.waitForEvent(Events.ONLINE_USER);
      await emitEvent({
        data: { online: true },
        directory: nodeA.state.directory,
        event: Events.ONLINE_USER,
        io: nodeA.io,
        users: [userB],
      });
      expect((await directToB).payload).toEqual({ online: true });

      await joinMembersInChatRoom({
        directory: nodeA.state.directory,
        io: nodeA.io,
        memberIds: [userB],
        roomToJoin: REMOTE_ROOM,
      });
      await waitFor(async () => (await nodeA.io.in(REMOTE_ROOM).fetchSockets())
        .some((socket) => socket.id === clientB.socketId));
      const joinedDelivery = clientB.waitForEvent(REMOTE_ROOM_EVENT);
      nodeA.io.to(REMOTE_ROOM).emit(REMOTE_ROOM_EVENT, { joined: true });
      expect((await joinedDelivery).payload).toEqual({ joined: true });

      await disconnectMembersFromChatRoom({
        directory: nodeA.state.directory,
        io: nodeA.io,
        memberIds: [userB],
        roomToLeave: REMOTE_ROOM,
      });
      await waitFor(async () => !(await nodeA.io.in(REMOTE_ROOM).fetchSockets())
        .some((socket) => socket.id === clientB.socketId));
      const noDelivery = clientB.waitForEvent(REMOTE_ROOM_EVENT, 350);
      nodeA.io.to(REMOTE_ROOM).emit(REMOTE_ROOM_EVENT, { joined: false });
      await expect(noDelivery).rejects.toThrow(
        "Timed out waiting for live Socket.IO event.",
      );

      let accepted = 0;
      let rejected = 0;
      for (let index = 0; index < 6; index += 1) {
        const client = index % 2 === 0 ? clientA : clientB;
        const decision = client.waitForEvent([
          LIMITED_ACCEPTED_EVENT,
          Events.SECURITY_ERROR,
        ]);
        client.emit(LIMITED_EVENT, { attempt: index });
        const packet = await decision;
        if (packet.event === LIMITED_ACCEPTED_EVENT) accepted += 1;
        else {
          rejected += 1;
          expect(packet.payload).toEqual({
            category: "RATE_LIMITED",
            event: LIMITED_EVENT,
          });
        }
      }
      expect({ accepted, rejected }).toEqual({ accepted: 4, rejected: 2 });

      const pollingClient = await LivePollingClient.connect(
        `http://127.0.0.1:${nodeA.port}`,
      );
      try {
        const pollingDelivery = pollingClient.waitForEvent(DIRECT_EVENT);
        nodeA.io.to(pollingClient.socketId).emit(DIRECT_EVENT, { polling: true });
        expect((await pollingDelivery).payload).toEqual({ polling: true });
      } finally {
        await pollingClient.close();
      }

      console.log(JSON.stringify({
        phase: "2D-5-socket",
        ports: [nodeA.port, nodeB.port],
        transports: [clientA.transport, clientB.transport, "polling"],
        redisClientsPerNode: 3,
        observedProjectRedisClients: 6,
      }));
      for (const [directory, userId, socketId] of [
        [nodeA.state.directory, userA, clientA.socketId],
        [nodeB.state.directory, userB, clientB.socketId],
        [nodeA.state.directory, sharedUser, clientA.socketId],
        [nodeB.state.directory, sharedUser, clientB.socketId],
      ] as const) {
        await directory.remove(userId, socketId).catch(() => undefined);
      }
    } finally {
      for (const client of clients) client.close();
      await Promise.allSettled([...nodes].reverse().map(closeLiveNode));
      await removeTestState(inspector, users, sockets);
    }

    await waitFor(async () => await clientCount(inspector) === baselineClients);
    expect(await clientCount(inspector)).toBe(baselineClients);
  });
});
