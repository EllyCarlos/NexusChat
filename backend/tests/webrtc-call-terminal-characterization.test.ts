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

vi.mock("../src/utils/safe-logger.utils.js", () => ({
  logServerError: vi.fn(),
}));

import { Events } from "../src/enums/event/event.enum.js";
import { prisma } from "../src/lib/prisma.lib.js";
import type { SocketConnectionDirectory } from "../src/socket/connection-directory.js";
import {
  SOCKET_EVENT_LIMITS,
  type SocketEventRateLimiter,
} from "../src/socket/socket-security.js";
import registerWebRtcHandlers from "../src/socket/webrtc/socket.js";
import { logServerError } from "../src/utils/safe-logger.utils.js";

const CALLER_ID = "cm72000000000000000000001";
const CALLEE_ID = "cm72000000000000000000002";
const CALL_ID = "cm72000000000000000000003";
const REQUESTED_CALL_ID = "cm72000000000000000000004";
const NOW = new Date("2026-08-29T08:15:00.000Z");
const DEFAULT_STARTED_AT = new Date(NOW.getTime() - 5_999);

type CallStatus = "RINGING" | "COMPLETED" | "MISSED" | "REJECTED" | "INTERRUPTED";
type EventHandler = (payload?: unknown) => Promise<void> | void;
type MockFunction = ReturnType<typeof vi.fn>;

const callFindFirst = vi.mocked(prisma.callHistory.findFirst);
const callUpdate = vi.mocked(prisma.callHistory.update);
const serverErrorLog = vi.mocked(logServerError);

const callRecord = ({
  id = CALL_ID,
  status = "RINGING",
  startedAt = DEFAULT_STARTED_AT,
  endedAt = null,
}: {
  id?: string;
  status?: CallStatus;
  startedAt?: Date;
  endedAt?: Date | null;
} = {}) => ({
  id,
  callerId: CALLER_ID,
  calleeId: CALLEE_ID,
  status,
  startedAt,
  endedAt,
});

const createHarness = ({
  actorUserId,
  consumeAll = vi.fn(() => true),
  getLatestSocket = vi.fn(),
  socketRelayEmit = vi.fn(),
  ioRelayEmit = vi.fn(),
}: {
  actorUserId: string;
  consumeAll?: MockFunction;
  getLatestSocket?: MockFunction;
  socketRelayEmit?: MockFunction;
  ioRelayEmit?: MockFunction;
}) => {
  const handlers = new Map<string, EventHandler>();
  const socketEmit = vi.fn();
  const socketTo = vi.fn(() => ({ emit: socketRelayEmit }));
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
  const directory = {
    getLatestSocket: async (userId: string) => getLatestSocket(userId),
  } as unknown as SocketConnectionDirectory;
  const limiter = { consumeAll } as unknown as SocketEventRateLimiter;

  registerWebRtcHandlers(
    socket as unknown as Socket,
    io as unknown as Server,
    { directory, limiter },
  );

  return {
    consumeAll,
    getLatestSocket,
    ioRelayEmit,
    ioTo,
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

const expectBefore = (
  first: MockFunction,
  second: MockFunction,
  firstIndex = 0,
  secondIndex = 0,
) => {
  expect(first.mock.invocationCallOrder[firstIndex]).toBeLessThan(
    second.mock.invocationCallOrder[secondIndex],
  );
};

const expectCustomErrorLog = (
  context: string,
  message: string,
  statusCode: number,
) => {
  expect(serverErrorLog).toHaveBeenCalledTimes(1);
  const [loggedContext, error] = serverErrorLog.mock.calls[0]!;
  expect(loggedContext).toBe(context);
  expect(error).toMatchObject({
    name: "CustomError",
    message,
    statusCode,
  });
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  callUpdate.mockResolvedValue({} as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CALL_END and CALLEE_BUSY transport cutoffs", () => {
  it.each([Events.CALL_END, Events.CALLEE_BUSY])(
    "%s parses before rate limiting, authorization, persistence, and delivery",
    async (event) => {
      const harness = createHarness({ actorUserId: CALLEE_ID });

      await harness.trigger(event, { callHistoryId: "not-a-cuid" });

      expect(harness.socketEmit).toHaveBeenCalledOnce();
      expect(harness.socketEmit).toHaveBeenCalledWith(Events.SECURITY_ERROR, {
        category: "INVALID_PAYLOAD",
        event,
      });
      expect(harness.consumeAll).not.toHaveBeenCalled();
      expect(callFindFirst).not.toHaveBeenCalled();
      expect(callUpdate).not.toHaveBeenCalled();
      expect(harness.getLatestSocket).not.toHaveBeenCalled();
      expect(harness.socketTo).not.toHaveBeenCalled();
      expect(harness.ioTo).not.toHaveBeenCalled();
      expect(serverErrorLog).not.toHaveBeenCalled();
    },
  );

  it.each([Events.CALL_END, Events.CALLEE_BUSY])(
    "%s stops at the actor limit before authorization",
    async (event) => {
      const consumeAll = vi.fn(() => false);
      const harness = createHarness({ actorUserId: CALLEE_ID, consumeAll });

      await harness.trigger(event, { callHistoryId: REQUESTED_CALL_ID });

      expect(consumeAll.mock.calls).toEqual([
        [[SOCKET_EVENT_LIMITS.callActor], [CALLEE_ID]],
      ]);
      expect(harness.socketEmit).toHaveBeenCalledWith(Events.SECURITY_ERROR, {
        category: "RATE_LIMITED",
        event,
      });
      expect(callFindFirst).not.toHaveBeenCalled();
      expect(callUpdate).not.toHaveBeenCalled();
      expect(harness.getLatestSocket).not.toHaveBeenCalled();
      expect(harness.socketTo).not.toHaveBeenCalled();
      expect(harness.ioTo).not.toHaveBeenCalled();
      expect(serverErrorLog).not.toHaveBeenCalled();
    },
  );
});

describe("CALL_END characterization", () => {
  it("persists RINGING as MISSED with one timestamp and floored duration before caller-then-callee io delivery", async () => {
    callFindFirst.mockResolvedValue(callRecord() as never);
    const getLatestSocket = vi.fn((userId: string) => ({
      [CALLER_ID]: "caller-socket",
      [CALLEE_ID]: "callee-socket",
    })[userId]);
    const harness = createHarness({ actorUserId: CALLER_ID, getLatestSocket });

    await harness.trigger(Events.CALL_END, { callHistoryId: REQUESTED_CALL_ID });

    expect(harness.consumeAll.mock.calls).toEqual([
      [[SOCKET_EVENT_LIMITS.callActor], [CALLER_ID]],
      [[SOCKET_EVENT_LIMITS.callState], [CALLER_ID, CALL_ID]],
    ]);
    expect(callUpdate).toHaveBeenCalledWith({
      where: { id: CALL_ID },
      data: {
        status: "MISSED",
        endedAt: NOW,
        duration: 5,
      },
    });
    expect(getLatestSocket.mock.calls).toEqual([
      [CALLER_ID],
      [CALLEE_ID],
    ]);
    expect(harness.ioTo.mock.calls).toEqual([
      ["caller-socket"],
      ["callee-socket"],
    ]);
    expect(harness.ioRelayEmit.mock.calls).toEqual([
      [Events.CALL_END],
      [Events.CALL_END],
    ]);
    expect(harness.socketTo).not.toHaveBeenCalled();
    expect(harness.socketEmit).not.toHaveBeenCalled();
    expect(serverErrorLog).not.toHaveBeenCalled();
    expectBefore(harness.consumeAll, callFindFirst, 0, 0);
    expectBefore(callFindFirst as unknown as MockFunction, harness.consumeAll, 0, 1);
    expectBefore(harness.consumeAll, callUpdate as unknown as MockFunction, 1, 0);
    expectBefore(callUpdate as unknown as MockFunction, getLatestSocket, 0, 0);
    expectBefore(getLatestSocket, harness.ioTo, 1, 0);
  });

  it("persists an active COMPLETED call as COMPLETED with the same duration semantics", async () => {
    const startedAt = new Date(NOW.getTime() - 7_001);
    callFindFirst.mockResolvedValue(callRecord({ status: "COMPLETED", startedAt }) as never);
    const harness = createHarness({ actorUserId: CALLEE_ID });

    await harness.trigger(Events.CALL_END, { callHistoryId: CALL_ID });

    expect(callUpdate).toHaveBeenCalledWith({
      where: { id: CALL_ID },
      data: {
        status: "COMPLETED",
        endedAt: NOW,
        duration: 7,
      },
    });
    expect(harness.getLatestSocket.mock.calls).toEqual([
      [CALLER_ID],
      [CALLEE_ID],
    ]);
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(serverErrorLog).not.toHaveBeenCalled();
  });

  it.each([
    ["RINGING with endedAt", "RINGING", new Date("2026-08-29T08:14:59.000Z")],
    ["COMPLETED with endedAt", "COMPLETED", new Date("2026-08-29T08:14:59.000Z")],
    ["MISSED without endedAt", "MISSED", null],
    ["REJECTED without endedAt", "REJECTED", null],
    ["INTERRUPTED without endedAt", "INTERRUPTED", null],
  ] satisfies Array<[string, CallStatus, Date | null]>)(
    "rejects terminal state %s before the call-scoped limit or any side effect",
    async (_label, status, endedAt) => {
      callFindFirst.mockResolvedValue(callRecord({ status, endedAt }) as never);
      const harness = createHarness({ actorUserId: CALLER_ID });

      await harness.trigger(Events.CALL_END, { callHistoryId: CALL_ID });

      expect(harness.consumeAll.mock.calls).toEqual([
        [[SOCKET_EVENT_LIMITS.callActor], [CALLER_ID]],
      ]);
      expect(callUpdate).not.toHaveBeenCalled();
      expect(harness.getLatestSocket).not.toHaveBeenCalled();
      expect(harness.ioTo).not.toHaveBeenCalled();
      expect(harness.socketTo).not.toHaveBeenCalled();
      expect(harness.socketEmit).not.toHaveBeenCalled();
      expectCustomErrorLog("CALL_END event failed.", "Call is already terminal", 409);
    },
  );

  it.each([
    ["caller is absent", undefined, "callee-socket", ["callee-socket"]],
    ["callee is absent", "caller-socket", undefined, ["caller-socket"]],
    ["both participants are absent", undefined, undefined, []],
  ] satisfies Array<[string, string | undefined, string | undefined, string[]]>)(
    "persists and performs only available io deliveries when %s",
    async (_label, callerSocketId, calleeSocketId, expectedTargets) => {
      callFindFirst.mockResolvedValue(callRecord() as never);
      const getLatestSocket = vi.fn((userId: string) => userId === CALLER_ID
        ? callerSocketId
        : calleeSocketId);
      const harness = createHarness({ actorUserId: CALLER_ID, getLatestSocket });

      await harness.trigger(Events.CALL_END, { callHistoryId: CALL_ID });

      expect(callUpdate).toHaveBeenCalledOnce();
      expect(getLatestSocket.mock.calls).toEqual([
        [CALLER_ID],
        [CALLEE_ID],
      ]);
      expect(harness.ioTo.mock.calls).toEqual(expectedTargets.map(target => [target]));
      expect(harness.ioRelayEmit.mock.calls).toEqual(
        expectedTargets.map(() => [Events.CALL_END]),
      );
      expect(harness.socketTo).not.toHaveBeenCalled();
      expect(harness.socketEmit).not.toHaveBeenCalled();
      expect(serverErrorLog).not.toHaveBeenCalled();
    },
  );

  it("stops before directory lookup when persistence fails and logs the exact boundary", async () => {
    const persistenceError = new Error("call end update failed");
    callFindFirst.mockResolvedValue(callRecord() as never);
    callUpdate.mockRejectedValueOnce(persistenceError);
    const harness = createHarness({ actorUserId: CALLER_ID });

    await harness.trigger(Events.CALL_END, { callHistoryId: CALL_ID });

    expect(callUpdate).toHaveBeenCalledOnce();
    expect(harness.getLatestSocket).not.toHaveBeenCalled();
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(harness.socketTo).not.toHaveBeenCalled();
    expect(harness.socketEmit).not.toHaveBeenCalled();
    expect(serverErrorLog).toHaveBeenCalledWith("CALL_END event failed.", persistenceError);
  });

  it("looks up both participants before delivery, so a callee lookup failure cuts off caller delivery", async () => {
    const lookupError = new Error("callee lookup failed");
    callFindFirst.mockResolvedValue(callRecord() as never);
    const getLatestSocket = vi.fn()
      .mockReturnValueOnce("caller-socket")
      .mockImplementationOnce(() => {
        throw lookupError;
      });
    const harness = createHarness({ actorUserId: CALLER_ID, getLatestSocket });

    await harness.trigger(Events.CALL_END, { callHistoryId: CALL_ID });

    expect(callUpdate).toHaveBeenCalledOnce();
    expect(getLatestSocket.mock.calls).toEqual([
      [CALLER_ID],
      [CALLEE_ID],
    ]);
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(harness.ioRelayEmit).not.toHaveBeenCalled();
    expect(serverErrorLog).toHaveBeenCalledWith("CALL_END event failed.", lookupError);
  });

  it("keeps the DB transition and cuts off callee delivery when caller delivery throws", async () => {
    const deliveryError = new Error("caller CALL_END delivery failed");
    callFindFirst.mockResolvedValue(callRecord() as never);
    const getLatestSocket = vi.fn((userId: string) => userId === CALLER_ID
      ? "caller-socket"
      : "callee-socket");
    const ioRelayEmit = vi.fn(() => {
      throw deliveryError;
    });
    const harness = createHarness({
      actorUserId: CALLER_ID,
      getLatestSocket,
      ioRelayEmit,
    });

    await harness.trigger(Events.CALL_END, { callHistoryId: CALL_ID });

    expect(callUpdate).toHaveBeenCalledOnce();
    expect(getLatestSocket).toHaveBeenCalledTimes(2);
    expect(harness.ioTo.mock.calls).toEqual([["caller-socket"]]);
    expect(ioRelayEmit.mock.calls).toEqual([[Events.CALL_END]]);
    expect(serverErrorLog).toHaveBeenCalledWith("CALL_END event failed.", deliveryError);
  });

  it("leaves caller delivery committed when the later callee delivery throws", async () => {
    const deliveryError = new Error("callee CALL_END delivery failed");
    callFindFirst.mockResolvedValue(callRecord() as never);
    const getLatestSocket = vi.fn((userId: string) => userId === CALLER_ID
      ? "caller-socket"
      : "callee-socket");
    const ioRelayEmit = vi.fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw deliveryError;
      });
    const harness = createHarness({
      actorUserId: CALLER_ID,
      getLatestSocket,
      ioRelayEmit,
    });

    await harness.trigger(Events.CALL_END, { callHistoryId: CALL_ID });

    expect(callUpdate).toHaveBeenCalledOnce();
    expect(harness.ioTo.mock.calls).toEqual([
      ["caller-socket"],
      ["callee-socket"],
    ]);
    expect(ioRelayEmit.mock.calls).toEqual([
      [Events.CALL_END],
      [Events.CALL_END],
    ]);
    expect(serverErrorLog).toHaveBeenCalledWith("CALL_END event failed.", deliveryError);
  });
});

describe("CALLEE_BUSY characterization", () => {
  it("persists MISSED with one timestamp and floored duration before CALLEE_BUSY then CALL_END via socket.to", async () => {
    callFindFirst.mockResolvedValue(callRecord() as never);
    const getLatestSocket = vi.fn(() => "caller-socket");
    const harness = createHarness({ actorUserId: CALLEE_ID, getLatestSocket });

    await harness.trigger(Events.CALLEE_BUSY, { callHistoryId: REQUESTED_CALL_ID });

    expect(harness.consumeAll.mock.calls).toEqual([
      [[SOCKET_EVENT_LIMITS.callActor], [CALLEE_ID]],
      [[SOCKET_EVENT_LIMITS.callState], [CALLEE_ID, CALL_ID]],
    ]);
    expect(callUpdate).toHaveBeenCalledWith({
      where: { id: CALL_ID },
      data: {
        status: "MISSED",
        endedAt: NOW,
        duration: 5,
      },
    });
    expect(getLatestSocket.mock.calls).toEqual([[CALLER_ID]]);
    expect(harness.socketTo.mock.calls).toEqual([
      ["caller-socket"],
      ["caller-socket"],
    ]);
    expect(harness.socketRelayEmit.mock.calls).toEqual([
      [Events.CALLEE_BUSY],
      [Events.CALL_END],
    ]);
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(harness.socketEmit).not.toHaveBeenCalled();
    expect(serverErrorLog).not.toHaveBeenCalled();
    expectBefore(harness.consumeAll, callFindFirst, 0, 0);
    expectBefore(callFindFirst as unknown as MockFunction, harness.consumeAll, 0, 1);
    expectBefore(harness.consumeAll, callUpdate as unknown as MockFunction, 1, 0);
    expectBefore(callUpdate as unknown as MockFunction, getLatestSocket, 0, 0);
    expectBefore(getLatestSocket, harness.socketTo, 0, 0);
    expectBefore(harness.socketTo, harness.socketRelayEmit, 0, 0);
    expectBefore(harness.socketRelayEmit, harness.socketTo, 0, 1);
    expectBefore(harness.socketTo, harness.socketRelayEmit, 1, 1);
  });

  it.each([
    ["RINGING with endedAt", "RINGING", new Date("2026-08-29T08:14:59.000Z")],
    ["COMPLETED without endedAt", "COMPLETED", null],
    ["MISSED without endedAt", "MISSED", null],
    ["REJECTED without endedAt", "REJECTED", null],
    ["INTERRUPTED without endedAt", "INTERRUPTED", null],
  ] satisfies Array<[string, CallStatus, Date | null]>)(
    "requires exactly a non-ended RINGING call and rejects %s",
    async (_label, status, endedAt) => {
      callFindFirst.mockResolvedValue(callRecord({ status, endedAt }) as never);
      const harness = createHarness({ actorUserId: CALLEE_ID });

      await harness.trigger(Events.CALLEE_BUSY, { callHistoryId: CALL_ID });

      expect(harness.consumeAll.mock.calls).toEqual([
        [[SOCKET_EVENT_LIMITS.callActor], [CALLEE_ID]],
      ]);
      expect(callUpdate).not.toHaveBeenCalled();
      expect(harness.getLatestSocket).not.toHaveBeenCalled();
      expect(harness.socketTo).not.toHaveBeenCalled();
      expect(harness.ioTo).not.toHaveBeenCalled();
      expect(harness.socketEmit).not.toHaveBeenCalled();
      expectCustomErrorLog(
        "CALLEE_BUSY event failed.",
        "Call is not awaiting an answer",
        409,
      );
    },
  );

  it("commits MISSED but performs no delivery and adds no self CALL_END when the caller socket is absent", async () => {
    callFindFirst.mockResolvedValue(callRecord() as never);
    const harness = createHarness({ actorUserId: CALLEE_ID });

    await harness.trigger(Events.CALLEE_BUSY, { callHistoryId: CALL_ID });

    expect(callUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: CALL_ID },
      data: expect.objectContaining({ status: "MISSED" }),
    }));
    expect(harness.getLatestSocket.mock.calls).toEqual([[CALLER_ID]]);
    expect(harness.socketTo).not.toHaveBeenCalled();
    expect(harness.socketRelayEmit).not.toHaveBeenCalled();
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(harness.socketEmit).not.toHaveBeenCalled();
    expect(serverErrorLog).not.toHaveBeenCalled();
  });

  it("stops before caller lookup when MISSED persistence fails and logs the exact boundary", async () => {
    const persistenceError = new Error("busy update failed");
    callFindFirst.mockResolvedValue(callRecord() as never);
    callUpdate.mockRejectedValueOnce(persistenceError);
    const harness = createHarness({ actorUserId: CALLEE_ID });

    await harness.trigger(Events.CALLEE_BUSY, { callHistoryId: CALL_ID });

    expect(callUpdate).toHaveBeenCalledOnce();
    expect(harness.getLatestSocket).not.toHaveBeenCalled();
    expect(harness.socketTo).not.toHaveBeenCalled();
    expect(harness.socketEmit).not.toHaveBeenCalled();
    expect(serverErrorLog).toHaveBeenCalledWith("CALLEE_BUSY event failed.", persistenceError);
  });

  it("keeps the MISSED transition when caller lookup fails and performs no delivery", async () => {
    const lookupError = new Error("caller lookup failed");
    callFindFirst.mockResolvedValue(callRecord() as never);
    const getLatestSocket = vi.fn(() => {
      throw lookupError;
    });
    const harness = createHarness({ actorUserId: CALLEE_ID, getLatestSocket });

    await harness.trigger(Events.CALLEE_BUSY, { callHistoryId: CALL_ID });

    expect(callUpdate).toHaveBeenCalledOnce();
    expect(getLatestSocket.mock.calls).toEqual([[CALLER_ID]]);
    expect(harness.socketTo).not.toHaveBeenCalled();
    expect(harness.socketRelayEmit).not.toHaveBeenCalled();
    expect(harness.socketEmit).not.toHaveBeenCalled();
    expect(serverErrorLog).toHaveBeenCalledWith("CALLEE_BUSY event failed.", lookupError);
  });

  it("keeps the MISSED transition and cuts off peer CALL_END when CALLEE_BUSY delivery throws", async () => {
    const deliveryError = new Error("CALLEE_BUSY delivery failed");
    callFindFirst.mockResolvedValue(callRecord() as never);
    const socketRelayEmit = vi.fn(() => {
      throw deliveryError;
    });
    const harness = createHarness({
      actorUserId: CALLEE_ID,
      getLatestSocket: vi.fn(() => "caller-socket"),
      socketRelayEmit,
    });

    await harness.trigger(Events.CALLEE_BUSY, { callHistoryId: CALL_ID });

    expect(callUpdate).toHaveBeenCalledOnce();
    expect(harness.socketTo.mock.calls).toEqual([["caller-socket"]]);
    expect(socketRelayEmit.mock.calls).toEqual([[Events.CALLEE_BUSY]]);
    expect(harness.socketEmit).not.toHaveBeenCalled();
    expect(serverErrorLog).toHaveBeenCalledWith("CALLEE_BUSY event failed.", deliveryError);
  });

  it("leaves CALLEE_BUSY delivered when the later peer CALL_END delivery throws", async () => {
    const deliveryError = new Error("peer CALL_END delivery failed");
    callFindFirst.mockResolvedValue(callRecord() as never);
    const socketRelayEmit = vi.fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw deliveryError;
      });
    const harness = createHarness({
      actorUserId: CALLEE_ID,
      getLatestSocket: vi.fn(() => "caller-socket"),
      socketRelayEmit,
    });

    await harness.trigger(Events.CALLEE_BUSY, { callHistoryId: CALL_ID });

    expect(callUpdate).toHaveBeenCalledOnce();
    expect(harness.socketTo.mock.calls).toEqual([
      ["caller-socket"],
      ["caller-socket"],
    ]);
    expect(socketRelayEmit.mock.calls).toEqual([
      [Events.CALLEE_BUSY],
      [Events.CALL_END],
    ]);
    expect(harness.socketEmit).not.toHaveBeenCalled();
    expect(serverErrorLog).toHaveBeenCalledWith("CALLEE_BUSY event failed.", deliveryError);
  });
});
