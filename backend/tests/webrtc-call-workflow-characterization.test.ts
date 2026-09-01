import type { Server, Socket } from "socket.io";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    friends: { findFirst: vi.fn() },
    callHistory: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../src/modules/notifications/push-notification.service.js", () => ({
  sendPushNotification: vi.fn(),
}));

import { Events } from "../src/enums/event/event.enum.js";
import { prisma } from "../src/lib/prisma.lib.js";
import type { SocketConnectionDirectory } from "../src/socket/connection-directory.js";
import { LocalSocketEventRateLimitAdapter } from "../src/socket/local-socket-event-rate-limit.adapter.js";
import { SOCKET_EVENT_LIMITS } from "../src/socket/socket-security.js";
import registerWebRtcHandlers from "../src/socket/webrtc/socket.js";
import { sendPushNotification } from "../src/modules/notifications/push-notification.service.js";
import type { LoggerPort } from "../src/observability/logger.port.js";

const CALLER_ID = "cm51000000000000000000001";
const CALLEE_ID = "cm51000000000000000000002";
const CALL_ID = "cm51000000000000000000003";
const CALLER_SOCKET_ID = "caller-socket";
const CALLEE_SOCKET_ID = "callee-socket";
const STARTED_AT = new Date("2026-08-29T05:00:00.250Z");
const ENDED_AT = new Date("2026-08-29T05:00:12.999Z");

const userFindUnique = vi.mocked(prisma.user.findUnique);
const friendFindFirst = vi.mocked(prisma.friends.findFirst);
const callFindFirst = vi.mocked(prisma.callHistory.findFirst);
const callCreate = vi.mocked(prisma.callHistory.create);
const callUpdate = vi.mocked(prisma.callHistory.update);
const pushNotification = vi.mocked(sendPushNotification);
const safeLog = vi.fn();
const testLogger: LoggerPort = {
  component: "socket",
  forComponent: () => testLogger,
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: safeLog,
};

type EventHandler = (payload: unknown) => Promise<void> | void;
type OrderedMock = { mock: { invocationCallOrder: number[] } };

const expectInvokedBefore = (
  first: OrderedMock,
  second: OrderedMock,
  firstIndex = 0,
  secondIndex = 0,
) => {
  expect(first.mock.invocationCallOrder[firstIndex]).toBeLessThan(
    second.mock.invocationCallOrder[secondIndex] as number,
  );
};

const callRecord = ({
  status = "RINGING",
  endedAt = null,
}: {
  status?: "RINGING" | "COMPLETED" | "MISSED" | "REJECTED" | "INTERRUPTED";
  endedAt?: Date | null;
} = {}) => ({
  id: CALL_ID,
  callerId: CALLER_ID,
  calleeId: CALLEE_ID,
  startedAt: STARTED_AT,
  endedAt,
  status,
});

const authorizeCallInitiation = ({
  notificationsEnabled = false,
  fcmToken = null,
}: {
  notificationsEnabled?: boolean;
  fcmToken?: string | null;
} = {}) => {
  userFindUnique.mockResolvedValue({
    id: CALLEE_ID,
    notificationsEnabled,
    fcmToken,
  } as never);
  friendFindFirst.mockResolvedValue({ id: "friendship" } as never);
};

const createHarness = (actorUserId: string) => {
  const handlers = new Map<string, EventHandler>();
  const socketIdsByUser = new Map<string, string[]>();
  const registryLookup = vi.fn(async (userId: string) => {
    const socketIds = socketIdsByUser.get(userId);
    return socketIds?.[socketIds.length - 1];
  });
  const directory = { getLatestSocket: registryLookup } as unknown as SocketConnectionDirectory;
  const addSocket = (userId: string, socketId: string) => {
    socketIdsByUser.set(userId, [...(socketIdsByUser.get(userId) ?? []), socketId]);
  };
  const limiter = new LocalSocketEventRateLimitAdapter();
  const limit = vi.spyOn(limiter, "consumeAll");
  const socketEmit = vi.fn();
  const socketRelayEmit = vi.fn();
  const socketTo = vi.fn(() => ({ emit: socketRelayEmit }));
  const ioRelayEmit = vi.fn();
  const ioTo = vi.fn(() => ({ emit: ioRelayEmit }));

  const socket = {
    user: {
      id: actorUserId,
      username: `user-${actorUserId}`,
      avatar: `avatar-${actorUserId}`,
    },
    on: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, handler);
      return socket;
    }),
    emit: socketEmit,
    to: socketTo,
    disconnect: vi.fn(),
  };
  const io = { to: ioTo };

  registerWebRtcHandlers(socket as unknown as Socket, io as unknown as Server, {
    directory,
    limiter,
    logger: testLogger,
  });

  return {
    ioRelayEmit,
    ioTo,
    limit,
    addSocket,
    registryLookup,
    socketEmit,
    socketRelayEmit,
    socketTo,
    trigger: async (event: Events, payload: unknown) => {
      const handler = handlers.get(event);
      expect(handler).toBeDefined();
      await handler!(payload);
    },
  };
};

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CALL_USER workflow characterization", () => {
  it("emits both offline events before missed persistence, then starts an eligible push without awaiting it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ENDED_AT);
    authorizeCallInitiation({ notificationsEnabled: true, fcmToken: "callee-token" });
    callCreate.mockResolvedValue({ id: CALL_ID } as never);
    let releasePush!: () => void;
    const pendingPush = new Promise<void>((resolve) => {
      releasePush = resolve;
    });
    pushNotification.mockReturnValue(pendingPush as never);
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.CALL_USER, {
      calleeId: CALLEE_ID,
      offer: { type: "offer", sdp: "offline-offer" },
    });

    expect(harness.limit).toHaveBeenNthCalledWith(
      1,
      [SOCKET_EVENT_LIMITS.callActor],
      [CALLER_ID],
    );
    expect(harness.limit).toHaveBeenNthCalledWith(
      2,
      [SOCKET_EVENT_LIMITS.callInitiation],
      [CALLER_ID, CALLEE_ID],
    );
    expect(harness.registryLookup).toHaveBeenCalledExactlyOnceWith(CALLEE_ID);
    expect(harness.socketEmit.mock.calls).toEqual([
      [Events.CALLEE_OFFLINE],
      [Events.CALL_END],
    ]);
    expect(callCreate).toHaveBeenCalledExactlyOnceWith({
      data: {
        callerId: CALLER_ID,
        calleeId: CALLEE_ID,
        status: "MISSED",
        endedAt: ENDED_AT,
        duration: 0,
      },
    });
    expect(pushNotification).toHaveBeenCalledExactlyOnceWith({
      recipientToken: "callee-token",
      body: `You have missed a call from user-${CALLER_ID}`,
      title: "Missed Call",
    });
    expectInvokedBefore(harness.limit, userFindUnique);
    expectInvokedBefore(userFindUnique, friendFindFirst);
    expectInvokedBefore(friendFindFirst, harness.limit, 0, 1);
    expectInvokedBefore(harness.limit, harness.registryLookup, 1);
    expectInvokedBefore(harness.registryLookup, harness.socketEmit);
    expectInvokedBefore(harness.socketEmit, harness.socketEmit, 0, 1);
    expectInvokedBefore(harness.socketEmit, callCreate, 1);
    expectInvokedBefore(callCreate, pushNotification);
    expect(harness.socketTo).not.toHaveBeenCalled();
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(safeLog).not.toHaveBeenCalled();

    releasePush();
  });

  it("does not request a missed-call push when notifications are enabled without a token", async () => {
    authorizeCallInitiation({ notificationsEnabled: true, fcmToken: null });
    callCreate.mockResolvedValue({ id: CALL_ID } as never);
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.CALL_USER, {
      calleeId: CALLEE_ID,
      offer: { type: "offer", sdp: "offline-offer" },
    });

    expect(callCreate).toHaveBeenCalledOnce();
    expect(pushNotification).not.toHaveBeenCalled();
  });

  it("cuts off CALL_END, persistence, and notification when the first offline delivery throws", async () => {
    authorizeCallInitiation({ notificationsEnabled: true, fcmToken: "callee-token" });
    const deliveryError = new Error("callee-offline delivery failed");
    const harness = createHarness(CALLER_ID);
    harness.socketEmit.mockImplementationOnce(() => {
      throw deliveryError;
    });

    await harness.trigger(Events.CALL_USER, {
      calleeId: CALLEE_ID,
      offer: { type: "offer", sdp: "offline-offer" },
    });

    expect(harness.socketEmit.mock.calls).toEqual([[Events.CALLEE_OFFLINE]]);
    expect(callCreate).not.toHaveBeenCalled();
    expect(pushNotification).not.toHaveBeenCalled();
    expect(safeLog).toHaveBeenCalledExactlyOnceWith(
      "socket.call_user.failed",
      { operation: "call_user", result: "failed", errorType: "Error" },
    );
  });

  it("keeps both offline deliveries when missed persistence fails and cuts off notification", async () => {
    authorizeCallInitiation({ notificationsEnabled: true, fcmToken: "callee-token" });
    const persistenceError = new Error("missed persistence failed");
    callCreate.mockRejectedValue(persistenceError);
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.CALL_USER, {
      calleeId: CALLEE_ID,
      offer: { type: "offer", sdp: "offline-offer" },
    });

    expect(harness.socketEmit.mock.calls).toEqual([
      [Events.CALLEE_OFFLINE],
      [Events.CALL_END],
    ]);
    expect(pushNotification).not.toHaveBeenCalled();
    expect(safeLog).toHaveBeenCalledExactlyOnceWith(
      "socket.call_user.failed",
      { operation: "call_user", result: "failed", errorType: "Error" },
    );
  });

  it("creates an online call before CALL_ID, then uses io.to for the exact INCOMING_CALL", async () => {
    authorizeCallInitiation();
    callCreate.mockResolvedValue({ id: CALL_ID } as never);
    const harness = createHarness(CALLER_ID);
    harness.addSocket(CALLEE_ID, CALLEE_SOCKET_ID);

    await harness.trigger(Events.CALL_USER, {
      calleeId: CALLEE_ID,
      offer: { type: "offer", sdp: "online-offer" },
    });

    expect(harness.limit).toHaveBeenNthCalledWith(
      1,
      [SOCKET_EVENT_LIMITS.callActor],
      [CALLER_ID],
    );
    expect(harness.limit).toHaveBeenNthCalledWith(
      2,
      [SOCKET_EVENT_LIMITS.callInitiation],
      [CALLER_ID, CALLEE_ID],
    );
    expect(harness.registryLookup).toHaveBeenCalledExactlyOnceWith(CALLEE_ID);
    expect(callCreate).toHaveBeenCalledExactlyOnceWith({
      data: { callerId: CALLER_ID, calleeId: CALLEE_ID },
    });
    expect(harness.socketEmit.mock.calls).toEqual([
      [Events.CALL_ID, { callHistoryId: CALL_ID }],
    ]);
    expect(harness.ioTo).toHaveBeenCalledExactlyOnceWith(CALLEE_SOCKET_ID);
    expect(harness.ioRelayEmit).toHaveBeenCalledExactlyOnceWith(Events.INCOMING_CALL, {
      caller: {
        id: CALLER_ID,
        username: `user-${CALLER_ID}`,
        avatar: `avatar-${CALLER_ID}`,
      },
      offer: { type: "offer", sdp: "online-offer" },
      callHistoryId: CALL_ID,
    });
    expectInvokedBefore(harness.limit, userFindUnique);
    expectInvokedBefore(userFindUnique, friendFindFirst);
    expectInvokedBefore(friendFindFirst, harness.limit, 0, 1);
    expectInvokedBefore(harness.limit, harness.registryLookup, 1);
    expectInvokedBefore(harness.registryLookup, callCreate);
    expectInvokedBefore(callCreate, harness.socketEmit);
    expectInvokedBefore(harness.socketEmit, harness.ioTo);
    expectInvokedBefore(harness.ioTo, harness.ioRelayEmit);
    expect(harness.socketTo).not.toHaveBeenCalled();
    expect(safeLog).not.toHaveBeenCalled();
  });

  it("keeps the created call and cuts off INCOMING_CALL when CALL_ID delivery throws", async () => {
    authorizeCallInitiation();
    callCreate.mockResolvedValue({ id: CALL_ID } as never);
    const deliveryError = new Error("call-id delivery failed");
    const harness = createHarness(CALLER_ID);
    harness.addSocket(CALLEE_ID, CALLEE_SOCKET_ID);
    harness.socketEmit.mockImplementationOnce(() => {
      throw deliveryError;
    });

    await harness.trigger(Events.CALL_USER, {
      calleeId: CALLEE_ID,
      offer: { type: "offer", sdp: "online-offer" },
    });

    expect(callCreate).toHaveBeenCalledOnce();
    expect(harness.socketEmit.mock.calls).toEqual([
      [Events.CALL_ID, { callHistoryId: CALL_ID }],
    ]);
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(harness.ioRelayEmit).not.toHaveBeenCalled();
    expect(safeLog).toHaveBeenCalledExactlyOnceWith(
      "socket.call_user.failed",
      { operation: "call_user", result: "failed", errorType: "Error" },
    );
  });
});

describe("CALL_ACCEPTED and CALL_REJECTED shared transport/state characterization", () => {
  it.each([
    [
      Events.CALL_ACCEPTED,
      { callerId: CALLER_ID, callHistoryId: CALL_ID },
    ],
    [
      Events.CALL_REJECTED,
      { callHistoryId: "not-a-cuid" },
    ],
  ])("parses %s before rate limiting or authorization", async (event, payload) => {
    const harness = createHarness(CALLEE_ID);

    await harness.trigger(event, payload);

    expect(harness.socketEmit).toHaveBeenCalledExactlyOnceWith(Events.SECURITY_ERROR, {
      category: "INVALID_PAYLOAD",
      event,
    });
    expect(harness.limit).not.toHaveBeenCalled();
    expect(callFindFirst).not.toHaveBeenCalled();
    expect(harness.registryLookup).not.toHaveBeenCalled();
    expect(callUpdate).not.toHaveBeenCalled();
    expect(safeLog).not.toHaveBeenCalled();
  });

  it.each([
    [
      Events.CALL_ACCEPTED,
      { callerId: CALLER_ID, callHistoryId: CALL_ID, answer: { type: "answer", sdp: "answer" } },
      "CALL_ACCEPTED event failed.",
      callRecord({ status: "COMPLETED" }),
    ],
    [
      Events.CALL_ACCEPTED,
      { callerId: CALLER_ID, callHistoryId: CALL_ID, answer: { type: "answer", sdp: "answer" } },
      "CALL_ACCEPTED event failed.",
      callRecord({ endedAt: ENDED_AT }),
    ],
    [
      Events.CALL_REJECTED,
      { callHistoryId: CALL_ID },
      "CALL_REJECTED event failed.",
      callRecord({ status: "COMPLETED" }),
    ],
    [
      Events.CALL_REJECTED,
      { callHistoryId: CALL_ID },
      "CALL_REJECTED event failed.",
      callRecord({ endedAt: ENDED_AT }),
    ],
  ])("applies the ringing guard before the resource limit for %s", async (
    event,
    payload,
    logContext,
    call,
  ) => {
    callFindFirst.mockResolvedValue(call as never);
    const harness = createHarness(CALLEE_ID);

    await harness.trigger(event, payload);

    expect(harness.limit).toHaveBeenCalledExactlyOnceWith(
      [SOCKET_EVENT_LIMITS.callActor],
      [CALLEE_ID],
    );
    expect(callFindFirst).toHaveBeenCalledOnce();
    expect(harness.registryLookup).not.toHaveBeenCalled();
    expect(callUpdate).not.toHaveBeenCalled();
    expect(harness.socketTo).not.toHaveBeenCalled();
    expect(harness.socketEmit).not.toHaveBeenCalled();
    expect(safeLog).toHaveBeenCalledWith(
      event === Events.CALL_ACCEPTED
        ? "socket.call_acceptance.failed"
        : "socket.call_rejection.failed",
      {
        operation: event === Events.CALL_ACCEPTED ? "call_accept" : "call_reject",
        result: "failed",
        errorType: "CustomError",
        applicationCode: "LEGACY_CUSTOM_ERROR",
      },
    );
  });

  it.each([
    [
      Events.CALL_ACCEPTED,
      { callerId: CALLER_ID, callHistoryId: CALL_ID, answer: { type: "answer", sdp: "answer" } },
    ],
    [Events.CALL_REJECTED, { callHistoryId: CALL_ID }],
  ])("authorizes and validates %s before a denied authoritative call-state limit", async (
    event,
    payload,
  ) => {
    callFindFirst.mockResolvedValue(callRecord() as never);
    const harness = createHarness(CALLEE_ID);
    harness.limit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await harness.trigger(event, payload);

    expect(harness.limit).toHaveBeenNthCalledWith(
      1,
      [SOCKET_EVENT_LIMITS.callActor],
      [CALLEE_ID],
    );
    expect(harness.limit).toHaveBeenNthCalledWith(
      2,
      [SOCKET_EVENT_LIMITS.callState],
      [CALLEE_ID, CALL_ID],
    );
    expectInvokedBefore(harness.limit, callFindFirst);
    expectInvokedBefore(callFindFirst, harness.limit, 0, 1);
    expect(harness.socketEmit).toHaveBeenCalledExactlyOnceWith(Events.SECURITY_ERROR, {
      category: "RATE_LIMITED",
      event,
    });
    expect(harness.registryLookup).not.toHaveBeenCalled();
    expect(callUpdate).not.toHaveBeenCalled();
    expect(harness.socketTo).not.toHaveBeenCalled();
    expect(safeLog).not.toHaveBeenCalled();
  });
});

describe("CALL_ACCEPTED workflow characterization", () => {
  it("looks up the authoritative caller, records MISSED, then emits CALL_END before CALLER_OFFLINE", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ENDED_AT);
    callFindFirst.mockResolvedValue(callRecord() as never);
    callUpdate.mockResolvedValue({ id: CALL_ID } as never);
    const harness = createHarness(CALLEE_ID);

    await harness.trigger(Events.CALL_ACCEPTED, {
      callerId: CALLER_ID,
      callHistoryId: CALL_ID,
      answer: { type: "answer", sdp: "answer" },
    });

    expect(harness.limit).toHaveBeenNthCalledWith(
      1,
      [SOCKET_EVENT_LIMITS.callActor],
      [CALLEE_ID],
    );
    expect(harness.limit).toHaveBeenNthCalledWith(
      2,
      [SOCKET_EVENT_LIMITS.callState],
      [CALLEE_ID, CALL_ID],
    );
    expect(harness.registryLookup).toHaveBeenCalledExactlyOnceWith(CALLER_ID);
    expect(callUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: CALL_ID },
      data: {
        status: "MISSED",
        endedAt: ENDED_AT,
        duration: 12,
      },
    });
    expect(harness.socketEmit.mock.calls).toEqual([
      [Events.CALL_END],
      [Events.CALLER_OFFLINE],
    ]);
    expectInvokedBefore(harness.limit, callFindFirst);
    expectInvokedBefore(callFindFirst, harness.limit, 0, 1);
    expectInvokedBefore(harness.limit, harness.registryLookup, 1);
    expectInvokedBefore(harness.registryLookup, callUpdate);
    expectInvokedBefore(callUpdate, harness.socketEmit);
    expectInvokedBefore(harness.socketEmit, harness.socketEmit, 0, 1);
    expect(harness.socketTo).not.toHaveBeenCalled();
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(safeLog).not.toHaveBeenCalled();
  });

  it("updates COMPLETED before relaying the exact answer with socket.to", async () => {
    callFindFirst.mockResolvedValue(callRecord() as never);
    callUpdate.mockResolvedValue({ id: CALL_ID } as never);
    const harness = createHarness(CALLEE_ID);
    harness.addSocket(CALLER_ID, CALLER_SOCKET_ID);

    await harness.trigger(Events.CALL_ACCEPTED, {
      callerId: CALLER_ID,
      callHistoryId: CALL_ID,
      answer: { type: "answer", sdp: "accepted-answer" },
    });

    expect(harness.registryLookup).toHaveBeenCalledExactlyOnceWith(CALLER_ID);
    expect(callUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: CALL_ID },
      data: { status: "COMPLETED" },
    });
    expect(harness.socketTo).toHaveBeenCalledExactlyOnceWith(CALLER_SOCKET_ID);
    expect(harness.socketRelayEmit).toHaveBeenCalledExactlyOnceWith(Events.CALL_ACCEPTED, {
      calleeId: CALLEE_ID,
      answer: { type: "answer", sdp: "accepted-answer" },
      callHistoryId: CALL_ID,
    });
    expectInvokedBefore(harness.limit, callFindFirst);
    expectInvokedBefore(callFindFirst, harness.limit, 0, 1);
    expectInvokedBefore(harness.limit, harness.registryLookup, 1);
    expectInvokedBefore(harness.registryLookup, callUpdate);
    expectInvokedBefore(callUpdate, harness.socketTo);
    expectInvokedBefore(harness.socketTo, harness.socketRelayEmit);
    expect(harness.socketEmit).not.toHaveBeenCalled();
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(safeLog).not.toHaveBeenCalled();
  });

  it("keeps the offline transition and cuts off CALLER_OFFLINE when actor CALL_END throws", async () => {
    callFindFirst.mockResolvedValue(callRecord() as never);
    callUpdate.mockResolvedValue({ id: CALL_ID } as never);
    const deliveryError = new Error("actor call-end delivery failed");
    const harness = createHarness(CALLEE_ID);
    harness.socketEmit.mockImplementationOnce(() => {
      throw deliveryError;
    });

    await harness.trigger(Events.CALL_ACCEPTED, {
      callerId: CALLER_ID,
      callHistoryId: CALL_ID,
      answer: { type: "answer", sdp: "answer" },
    });

    expect(callUpdate).toHaveBeenCalledOnce();
    expect(harness.socketEmit.mock.calls).toEqual([[Events.CALL_END]]);
    expect(safeLog).toHaveBeenCalledExactlyOnceWith(
      "socket.call_acceptance.failed",
      { operation: "call_accept", result: "failed", errorType: "Error" },
    );
  });
});

describe("CALL_REJECTED workflow characterization", () => {
  it("persists REJECTED before peer REJECTED, peer END, and actor END using socket.to", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ENDED_AT);
    callFindFirst.mockResolvedValue(callRecord() as never);
    callUpdate.mockResolvedValue({ id: CALL_ID } as never);
    const harness = createHarness(CALLEE_ID);
    harness.addSocket(CALLER_ID, CALLER_SOCKET_ID);

    await harness.trigger(Events.CALL_REJECTED, { callHistoryId: CALL_ID });

    expect(harness.limit).toHaveBeenNthCalledWith(
      1,
      [SOCKET_EVENT_LIMITS.callActor],
      [CALLEE_ID],
    );
    expect(harness.limit).toHaveBeenNthCalledWith(
      2,
      [SOCKET_EVENT_LIMITS.callState],
      [CALLEE_ID, CALL_ID],
    );
    expect(callUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: CALL_ID },
      data: {
        status: "REJECTED",
        endedAt: ENDED_AT,
        duration: 12,
      },
    });
    expect(harness.registryLookup).toHaveBeenCalledExactlyOnceWith(CALLER_ID);
    expect(harness.socketTo.mock.calls).toEqual([
      [CALLER_SOCKET_ID],
      [CALLER_SOCKET_ID],
    ]);
    expect(harness.socketRelayEmit.mock.calls).toEqual([
      [Events.CALL_REJECTED],
      [Events.CALL_END],
    ]);
    expect(harness.socketEmit.mock.calls).toEqual([[Events.CALL_END]]);
    expectInvokedBefore(harness.limit, callFindFirst);
    expectInvokedBefore(callFindFirst, harness.limit, 0, 1);
    expectInvokedBefore(harness.limit, callUpdate, 1);
    expectInvokedBefore(callUpdate, harness.registryLookup);
    expectInvokedBefore(harness.registryLookup, harness.socketTo);
    expectInvokedBefore(harness.socketTo, harness.socketRelayEmit);
    expectInvokedBefore(harness.socketRelayEmit, harness.socketTo, 0, 1);
    expectInvokedBefore(harness.socketTo, harness.socketRelayEmit, 1, 1);
    expectInvokedBefore(harness.socketRelayEmit, harness.socketEmit, 1);
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(safeLog).not.toHaveBeenCalled();
  });

  it("skips peer delivery when the caller socket is absent but still ends the rejecting actor", async () => {
    callFindFirst.mockResolvedValue(callRecord() as never);
    callUpdate.mockResolvedValue({ id: CALL_ID } as never);
    const harness = createHarness(CALLEE_ID);

    await harness.trigger(Events.CALL_REJECTED, { callHistoryId: CALL_ID });

    expect(callUpdate).toHaveBeenCalledOnce();
    expect(harness.registryLookup).toHaveBeenCalledExactlyOnceWith(CALLER_ID);
    expect(harness.socketTo).not.toHaveBeenCalled();
    expect(harness.socketRelayEmit).not.toHaveBeenCalled();
    expect(harness.socketEmit.mock.calls).toEqual([[Events.CALL_END]]);
    expectInvokedBefore(callUpdate, harness.registryLookup);
    expectInvokedBefore(harness.registryLookup, harness.socketEmit);
    expect(safeLog).not.toHaveBeenCalled();
  });

  it("keeps REJECTED persisted and cuts off both END deliveries when peer REJECTED throws", async () => {
    callFindFirst.mockResolvedValue(callRecord() as never);
    callUpdate.mockResolvedValue({ id: CALL_ID } as never);
    const deliveryError = new Error("peer rejected delivery failed");
    const harness = createHarness(CALLEE_ID);
    harness.addSocket(CALLER_ID, CALLER_SOCKET_ID);
    harness.socketRelayEmit.mockImplementationOnce(() => {
      throw deliveryError;
    });

    await harness.trigger(Events.CALL_REJECTED, { callHistoryId: CALL_ID });

    expect(callUpdate).toHaveBeenCalledOnce();
    expect(harness.socketTo.mock.calls).toEqual([[CALLER_SOCKET_ID]]);
    expect(harness.socketRelayEmit.mock.calls).toEqual([[Events.CALL_REJECTED]]);
    expect(harness.socketEmit).not.toHaveBeenCalled();
    expect(safeLog).toHaveBeenCalledExactlyOnceWith(
      "socket.call_rejection.failed",
      { operation: "call_reject", result: "failed", errorType: "Error" },
    );
  });

  it("keeps peer REJECTED but cuts off actor END when peer CALL_END throws", async () => {
    callFindFirst.mockResolvedValue(callRecord() as never);
    callUpdate.mockResolvedValue({ id: CALL_ID } as never);
    const deliveryError = new Error("peer call-end delivery failed");
    const harness = createHarness(CALLEE_ID);
    harness.addSocket(CALLER_ID, CALLER_SOCKET_ID);
    harness.socketRelayEmit
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw deliveryError;
      });

    await harness.trigger(Events.CALL_REJECTED, { callHistoryId: CALL_ID });

    expect(callUpdate).toHaveBeenCalledOnce();
    expect(harness.socketTo.mock.calls).toEqual([
      [CALLER_SOCKET_ID],
      [CALLER_SOCKET_ID],
    ]);
    expect(harness.socketRelayEmit.mock.calls).toEqual([
      [Events.CALL_REJECTED],
      [Events.CALL_END],
    ]);
    expect(harness.socketEmit).not.toHaveBeenCalled();
    expect(safeLog).toHaveBeenCalledExactlyOnceWith(
      "socket.call_rejection.failed",
      { operation: "call_reject", result: "failed", errorType: "Error" },
    );
  });
});
