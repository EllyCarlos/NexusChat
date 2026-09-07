import type { Server, Socket } from "socket.io";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertCallCallee: vi.fn(),
  assertCallParticipant: vi.fn(),
  assertCanCallUser: vi.fn(),
  callHistoryCreate: vi.fn(),
  callHistoryUpdate: vi.fn(),
  logServerError: vi.fn(),
  sendPushNotification: vi.fn(),
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    callHistory: {
      create: mocks.callHistoryCreate,
      update: mocks.callHistoryUpdate,
    },
  },
}));

vi.mock("../src/services/authorization.service.js", () => ({
  assertCallCallee: mocks.assertCallCallee,
  assertCallParticipant: mocks.assertCallParticipant,
  assertCanCallUser: mocks.assertCanCallUser,
}));

vi.mock("../src/modules/notifications/push-notification.service.js", () => ({
  sendPushNotification: mocks.sendPushNotification,
}));

vi.mock("../src/utils/safe-logger.utils.js", () => ({
  logServerError: mocks.logServerError,
}));

import { Events } from "../src/enums/event/event.enum.js";
import type { SocketConnectionDirectory } from "../src/socket/connection-directory.js";
import type { SocketEventRateLimitPort } from "../src/socket/socket-event-rate-limit.port.js";
import { SOCKET_EVENT_LIMITS } from "../src/socket/socket-security.js";
import registerWebRtcHandlers from "../src/socket/webrtc/socket.js";
import { CustomError } from "../src/utils/error.utils.js";
import type { LoggerPort } from "../src/observability/logger.port.js";
import { createCapturingMetrics } from "./support/capturing-metrics.js";

const testLogger: LoggerPort = {
  component: "socket",
  forComponent: () => testLogger,
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: mocks.logServerError,
};

const CALLER_ID = "cm51000000000000000000001";
const CALLEE_ID = "cm51000000000000000000002";
const CALL_ID = "cm51000000000000000000003";
const FOREIGN_ID = "cm51000000000000000000004";
const NOW = new Date("2026-08-29T12:00:05.000Z");
const STARTED_AT = new Date("2026-08-29T12:00:00.000Z");

const candidate = {
  candidate: "candidate:1 1 UDP 2122260223 192.0.2.1 5000 typ host",
  sdpMid: "audio",
  sdpMLineIndex: 0,
  usernameFragment: "nexus",
};
const offer = { type: "offer" as const, sdp: "negotiation-offer" };
const answer = { type: "answer" as const, sdp: "negotiation-answer" };

const activeCall = ({
  endedAt = null,
  status = "COMPLETED",
}: {
  endedAt?: Date | null;
  status?: "RINGING" | "COMPLETED" | "MISSED" | "REJECTED" | "INTERRUPTED";
} = {}) => ({
  id: CALL_ID,
  callerId: CALLER_ID,
  calleeId: CALLEE_ID,
  startedAt: STARTED_AT,
  endedAt,
  status,
});

const icePayload = (targetId = CALLEE_ID) => ({
  callHistoryId: CALL_ID,
  calleeId: targetId,
  candidate,
});

const negotiationNeededPayload = (targetId = CALLEE_ID) => ({
  callHistoryId: CALL_ID,
  calleeId: targetId,
  offer,
});

const negotiationDonePayload = (targetId = CALLER_ID) => ({
  callHistoryId: CALL_ID,
  callerId: targetId,
  answer,
});

type EventHandler = (payload?: unknown) => Promise<void> | void;
type TestConnectionDirectory = SocketConnectionDirectory & {
  addSocket(userId: string, socketId: string): void;
  getLatestSocket: ReturnType<typeof vi.fn>;
};

const createTestConnectionDirectory = (): TestConnectionDirectory => {
  const socketIdsByUser = new Map<string, string[]>();
  const getLatestSocket = vi.fn(async (userId: string) => {
    const socketIds = socketIdsByUser.get(userId);
    return socketIds?.[socketIds.length - 1];
  });

  return {
    addSocket: (userId: string, socketId: string) => {
      socketIdsByUser.set(userId, [...(socketIdsByUser.get(userId) ?? []), socketId]);
    },
    getLatestSocket,
  } as unknown as TestConnectionDirectory;
};

const createLimiter = (
  implementation: (
    policies: readonly unknown[],
    keyParts: readonly string[],
  ) => boolean | Promise<boolean> = () => true,
) => {
  const consumeAll = vi.fn(async (
    policies: readonly unknown[],
    keyParts: readonly string[],
  ) => implementation(policies, keyParts));
  return {
    consumeAll,
    limiter: {
      consume: vi.fn(async () => true),
      consumeAll,
    } satisfies SocketEventRateLimitPort,
  };
};

const createHarness = ({
  actorId = CALLER_ID,
  directory = createTestConnectionDirectory(),
  ioRelayEmit = vi.fn(),
  limiter = createLimiter().limiter,
  metrics = createCapturingMetrics(),
  socketEmit = vi.fn(),
  socketRelayEmit = vi.fn(),
}: {
  actorId?: string;
  directory?: TestConnectionDirectory;
  ioRelayEmit?: ReturnType<typeof vi.fn>;
  limiter?: SocketEventRateLimitPort;
  metrics?: ReturnType<typeof createCapturingMetrics>;
  socketEmit?: ReturnType<typeof vi.fn>;
  socketRelayEmit?: ReturnType<typeof vi.fn>;
} = {}) => {
  const handlers = new Map<string, EventHandler>();
  const socketTo = vi.fn((_socketId: string) => ({ emit: socketRelayEmit }));
  const ioTo = vi.fn((_socketId: string) => ({ emit: ioRelayEmit }));
  const { getLatestSocket } = directory;
  const socket = {
    id: `socket-${actorId}`,
    user: {
      id: actorId,
      username: `user-${actorId}`,
      avatar: `avatar-${actorId}`,
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
    metrics,
  });

  return {
    getLatestSocket,
    ioRelayEmit,
    ioTo,
    metrics,
    socketEmit,
    socketRelayEmit,
    socketTo,
    trigger: async (event: Events, payload?: unknown) => {
      const handler = handlers.get(event);
      expect(handler).toBeDefined();
      await handler!(payload);
    },
  };
};

const workflowCases = [
  {
    actorId: CALLER_ID,
    actorPolicy: SOCKET_EVENT_LIMITS.iceActor,
    callPolicy: SOCKET_EVENT_LIMITS.iceCall,
    event: Events.ICE_CANDIDATE,
    failureLog: "socket.ice_candidate.failed",
    operation: "ice_candidate",
    payload: icePayload,
  },
  {
    actorId: CALLER_ID,
    actorPolicy: SOCKET_EVENT_LIMITS.negotiationActor,
    callPolicy: SOCKET_EVENT_LIMITS.negotiationCall,
    event: Events.NEGO_NEEDED,
    failureLog: "socket.negotiation_needed.failed",
    operation: "negotiation_needed",
    payload: negotiationNeededPayload,
  },
  {
    actorId: CALLEE_ID,
    actorPolicy: SOCKET_EVENT_LIMITS.negotiationActor,
    callPolicy: SOCKET_EVENT_LIMITS.negotiationCall,
    event: Events.NEGO_DONE,
    failureLog: "socket.negotiation_done.failed",
    operation: "negotiation_done",
    payload: negotiationDonePayload,
  },
] as const;

const expectNoPersistenceOrTargetDelivery = (
  harness: ReturnType<typeof createHarness>,
): void => {
  expect(mocks.callHistoryUpdate).not.toHaveBeenCalled();
  expect(harness.socketRelayEmit).not.toHaveBeenCalled();
  expect(harness.ioRelayEmit).not.toHaveBeenCalled();
};

const expectActiveGuardError = (failureLog: string, operation: "ice_candidate" | "negotiation_needed" | "negotiation_done"): void => {
  expect(mocks.logServerError).toHaveBeenCalledTimes(1);
  const [context, fields] = mocks.logServerError.mock.calls[0];
  expect(context).toBe(failureLog);
  expect(fields).toEqual({
    operation,
    result: "failed",
    errorType: "CustomError",
    applicationCode: "LEGACY_CUSTOM_ERROR",
  });
};

const expectParticipantMismatchError = (failureLog: string, operation: "ice_candidate" | "negotiation_needed" | "negotiation_done"): void => {
  expect(mocks.logServerError).toHaveBeenCalledTimes(1);
  const [context, fields] = mocks.logServerError.mock.calls[0];
  expect(context).toBe(failureLog);
  expect(fields).toEqual({
    operation,
    result: "failed",
    errorType: "CustomError",
    applicationCode: "LEGACY_CUSTOM_ERROR",
  });
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.assertCallParticipant.mockResolvedValue(activeCall());
  mocks.callHistoryUpdate.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WebRTC negotiation parsing and guard order", () => {
  it.each(workflowCases)("parses $event before consuming its actor limit", async ({
    actorId,
    event,
  }) => {
    const { consumeAll, limiter } = createLimiter();
    const harness = createHarness({ actorId, limiter });

    await harness.trigger(event, { callHistoryId: CALL_ID });

    expect(harness.socketEmit).toHaveBeenCalledWith(Events.SECURITY_ERROR, {
      category: "INVALID_PAYLOAD",
      event,
    });
    expect(consumeAll).not.toHaveBeenCalled();
    expect(mocks.assertCallParticipant).not.toHaveBeenCalled();
    expect(harness.getLatestSocket).not.toHaveBeenCalled();
    expect(mocks.logServerError).not.toHaveBeenCalled();
    expectNoPersistenceOrTargetDelivery(harness);
  });

  it.each(workflowCases)("applies the $event actor limit before authorization", async ({
    actorId,
    actorPolicy,
    event,
    payload,
  }) => {
    const { consumeAll, limiter } = createLimiter(() => false);
    const harness = createHarness({ actorId, limiter });

    await harness.trigger(event, payload());

    expect(consumeAll).toHaveBeenCalledOnce();
    expect(consumeAll).toHaveBeenCalledWith([actorPolicy], [actorId]);
    expect(harness.socketEmit).toHaveBeenCalledWith(Events.SECURITY_ERROR, {
      category: "RATE_LIMITED",
      event,
    });
    expect(mocks.assertCallParticipant).not.toHaveBeenCalled();
    expect(harness.getLatestSocket).not.toHaveBeenCalled();
    expect(mocks.logServerError).not.toHaveBeenCalled();
    expectNoPersistenceOrTargetDelivery(harness);
  });

  it("fails ICE admission closed when the limiter provider rejects", async () => {
    const providerFailure = new Error("private Redis provider detail");
    const { consumeAll, limiter } = createLimiter(async () => {
      throw providerFailure;
    });
    const harness = createHarness({ actorId: CALLER_ID, limiter });

    await harness.trigger(Events.ICE_CANDIDATE, icePayload());

    expect(consumeAll).toHaveBeenCalledOnce();
    expect(consumeAll).toHaveBeenCalledWith(
      [SOCKET_EVENT_LIMITS.iceActor],
      [CALLER_ID],
    );
    expect(harness.socketEmit).toHaveBeenCalledWith(Events.SECURITY_ERROR, {
      category: "RATE_LIMITED",
      event: Events.ICE_CANDIDATE,
    });
    expect(mocks.logServerError).toHaveBeenCalledWith(
      "socket.rate_limit.unavailable",
      {
        operation: "ice_candidate",
        result: "unavailable",
        errorType: "Error",
      },
    );
    expect(JSON.stringify(mocks.logServerError.mock.calls))
      .not.toContain(providerFailure.message);
    expect(mocks.assertCallParticipant).not.toHaveBeenCalled();
    expect(harness.getLatestSocket).not.toHaveBeenCalled();
    expectNoPersistenceOrTargetDelivery(harness);
  });

  it.each(workflowCases)("stops $event after the participant guard fails", async ({
    actorId,
    actorPolicy,
    event,
    failureLog,
    operation,
    payload,
  }) => {
    const authorizationError = new CustomError("Call not found", 404);
    mocks.assertCallParticipant.mockRejectedValueOnce(authorizationError);
    const { consumeAll, limiter } = createLimiter();
    const harness = createHarness({ actorId, limiter });

    await harness.trigger(event, payload());

    expect(consumeAll).toHaveBeenCalledOnce();
    expect(consumeAll).toHaveBeenCalledWith([actorPolicy], [actorId]);
    expect(mocks.assertCallParticipant).toHaveBeenCalledWith(actorId, CALL_ID);
    expect(harness.getLatestSocket).not.toHaveBeenCalled();
    expect(mocks.logServerError).toHaveBeenCalledWith(failureLog, {
      operation,
      result: "failed",
      errorType: "CustomError",
      applicationCode: "LEGACY_CUSTOM_ERROR",
    });
    expectNoPersistenceOrTargetDelivery(harness);
  });

  it.each(workflowCases)("requires an unterminated active call for $event", async ({
    actorId,
    actorPolicy,
    event,
    failureLog,
    operation,
    payload,
  }) => {
    mocks.assertCallParticipant.mockResolvedValueOnce(activeCall({ endedAt: NOW }));
    const { consumeAll, limiter } = createLimiter();
    const harness = createHarness({ actorId, limiter });

    await harness.trigger(event, payload());

    expect(consumeAll).toHaveBeenCalledOnce();
    expect(consumeAll).toHaveBeenCalledWith([actorPolicy], [actorId]);
    expect(mocks.assertCallParticipant).toHaveBeenCalledWith(actorId, CALL_ID);
    expect(harness.getLatestSocket).not.toHaveBeenCalled();
    expectActiveGuardError(failureLog, operation);
    expectNoPersistenceOrTargetDelivery(harness);
  });

  it.each(workflowCases)("derives the authoritative other participant for $event", async ({
    actorId,
    actorPolicy,
    event,
    failureLog,
    operation,
    payload,
  }) => {
    const { consumeAll, limiter } = createLimiter();
    const harness = createHarness({ actorId, limiter });

    await harness.trigger(event, payload(FOREIGN_ID));

    expect(consumeAll).toHaveBeenCalledOnce();
    expect(consumeAll).toHaveBeenCalledWith([actorPolicy], [actorId]);
    expect(mocks.assertCallParticipant).toHaveBeenCalledWith(actorId, CALL_ID);
    expect(harness.getLatestSocket).not.toHaveBeenCalled();
    expectParticipantMismatchError(failureLog, operation);
    expectNoPersistenceOrTargetDelivery(harness);
  });
});

describe("ICE_CANDIDATE workflow compatibility", () => {
  it("authorizes, rate-limits by authoritative call, selects the latest peer socket, and uses io.to", async () => {
    const directory = createTestConnectionDirectory();
    directory.addSocket(CALLEE_ID, "callee-older-socket");
    directory.addSocket(CALLEE_ID, "callee-latest-socket");
    const { consumeAll, limiter } = createLimiter();
    const harness = createHarness({ actorId: CALLER_ID, directory, limiter });

    await harness.trigger(Events.ICE_CANDIDATE, icePayload());

    expect(consumeAll).toHaveBeenNthCalledWith(
      1,
      [SOCKET_EVENT_LIMITS.iceActor],
      [CALLER_ID],
    );
    expect(consumeAll).toHaveBeenNthCalledWith(
      2,
      [SOCKET_EVENT_LIMITS.iceCall],
      [CALLER_ID, CALL_ID],
    );
    expect(consumeAll.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.assertCallParticipant.mock.invocationCallOrder[0],
    );
    expect(mocks.assertCallParticipant.mock.invocationCallOrder[0]).toBeLessThan(
      consumeAll.mock.invocationCallOrder[1],
    );
    expect(consumeAll.mock.invocationCallOrder[1]).toBeLessThan(
      harness.getLatestSocket.mock.invocationCallOrder[0],
    );
    expect(harness.getLatestSocket).toHaveBeenCalledOnce();
    expect(harness.getLatestSocket).toHaveBeenCalledWith(CALLEE_ID);
    expect(harness.ioTo).toHaveBeenCalledOnce();
    expect(harness.ioTo).toHaveBeenCalledWith("callee-latest-socket");
    expect(harness.ioRelayEmit).toHaveBeenCalledWith(Events.ICE_CANDIDATE, {
      callerId: CALLER_ID,
      candidate,
      callHistoryId: CALL_ID,
    });
    expect(harness.socketTo).not.toHaveBeenCalled();
    expect(harness.socketEmit).not.toHaveBeenCalled();
    expect(mocks.callHistoryUpdate).not.toHaveBeenCalled();
    expect(mocks.logServerError).not.toHaveBeenCalled();
  });

  it("silently returns without mutation or delivery when the peer has no socket", async () => {
    const { consumeAll, limiter } = createLimiter();
    const harness = createHarness({ actorId: CALLER_ID, limiter });

    await harness.trigger(Events.ICE_CANDIDATE, icePayload());

    expect(consumeAll).toHaveBeenNthCalledWith(
      2,
      [SOCKET_EVENT_LIMITS.iceCall],
      [CALLER_ID, CALL_ID],
    );
    expect(harness.getLatestSocket).toHaveBeenCalledWith(CALLEE_ID);
    expect(harness.socketEmit).not.toHaveBeenCalled();
    expect(harness.socketTo).not.toHaveBeenCalled();
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(mocks.callHistoryUpdate).not.toHaveBeenCalled();
    expect(mocks.logServerError).not.toHaveBeenCalled();
  });
});

describe("NEGO_NEEDED workflow compatibility", () => {
  it("authorizes, rate-limits by authoritative call, selects the latest peer socket, and uses socket.to", async () => {
    const directory = createTestConnectionDirectory();
    directory.addSocket(CALLEE_ID, "callee-older-socket");
    directory.addSocket(CALLEE_ID, "callee-latest-socket");
    const { consumeAll, limiter } = createLimiter();
    const harness = createHarness({ actorId: CALLER_ID, directory, limiter });

    await harness.trigger(Events.NEGO_NEEDED, negotiationNeededPayload());

    expect(consumeAll).toHaveBeenNthCalledWith(
      1,
      [SOCKET_EVENT_LIMITS.negotiationActor],
      [CALLER_ID],
    );
    expect(consumeAll).toHaveBeenNthCalledWith(
      2,
      [SOCKET_EVENT_LIMITS.negotiationCall],
      [CALLER_ID, CALL_ID],
    );
    expect(consumeAll.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.assertCallParticipant.mock.invocationCallOrder[0],
    );
    expect(mocks.assertCallParticipant.mock.invocationCallOrder[0]).toBeLessThan(
      consumeAll.mock.invocationCallOrder[1],
    );
    expect(consumeAll.mock.invocationCallOrder[1]).toBeLessThan(
      harness.getLatestSocket.mock.invocationCallOrder[0],
    );
    expect(harness.getLatestSocket).toHaveBeenCalledOnce();
    expect(harness.getLatestSocket).toHaveBeenCalledWith(CALLEE_ID);
    expect(harness.socketTo).toHaveBeenCalledOnce();
    expect(harness.socketTo).toHaveBeenCalledWith("callee-latest-socket");
    expect(harness.socketRelayEmit).toHaveBeenCalledWith(Events.NEGO_NEEDED, {
      offer,
      callerId: CALLER_ID,
      callHistoryId: CALL_ID,
    });
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(harness.socketEmit).not.toHaveBeenCalled();
    expect(mocks.callHistoryUpdate).not.toHaveBeenCalled();
    expect(mocks.logServerError).not.toHaveBeenCalled();
  });

  it("persists interruption before CALLEE_OFFLINE then CALL_END when the peer is offline", async () => {
    const { limiter } = createLimiter();
    const harness = createHarness({ actorId: CALLER_ID, limiter });

    await harness.trigger(Events.NEGO_NEEDED, negotiationNeededPayload());

    expect(harness.getLatestSocket).toHaveBeenCalledWith(CALLEE_ID);
    expect(mocks.callHistoryUpdate).toHaveBeenCalledWith({
      where: { id: CALL_ID },
      data: {
        status: "INTERRUPTED",
        endedAt: NOW,
        duration: 5,
      },
    });
    expect(harness.socketEmit).toHaveBeenNthCalledWith(1, Events.CALLEE_OFFLINE);
    expect(harness.socketEmit).toHaveBeenNthCalledWith(2, Events.CALL_END);
    expect(mocks.callHistoryUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      harness.socketEmit.mock.invocationCallOrder[0],
    );
    expect(harness.socketEmit.mock.invocationCallOrder[0]).toBeLessThan(
      harness.socketEmit.mock.invocationCallOrder[1],
    );
    expect(harness.socketTo).not.toHaveBeenCalled();
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(mocks.logServerError).not.toHaveBeenCalled();
  });
});

describe("NEGO_DONE workflow compatibility", () => {
  it("authorizes, rate-limits by authoritative call, selects the latest peer socket, and emits NEGO_FINAL with socket.to", async () => {
    const directory = createTestConnectionDirectory();
    directory.addSocket(CALLER_ID, "caller-older-socket");
    directory.addSocket(CALLER_ID, "caller-latest-socket");
    const { consumeAll, limiter } = createLimiter();
    const harness = createHarness({ actorId: CALLEE_ID, directory, limiter });

    await harness.trigger(Events.NEGO_DONE, negotiationDonePayload());

    expect(consumeAll).toHaveBeenNthCalledWith(
      1,
      [SOCKET_EVENT_LIMITS.negotiationActor],
      [CALLEE_ID],
    );
    expect(consumeAll).toHaveBeenNthCalledWith(
      2,
      [SOCKET_EVENT_LIMITS.negotiationCall],
      [CALLEE_ID, CALL_ID],
    );
    expect(consumeAll.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.assertCallParticipant.mock.invocationCallOrder[0],
    );
    expect(mocks.assertCallParticipant.mock.invocationCallOrder[0]).toBeLessThan(
      consumeAll.mock.invocationCallOrder[1],
    );
    expect(consumeAll.mock.invocationCallOrder[1]).toBeLessThan(
      harness.getLatestSocket.mock.invocationCallOrder[0],
    );
    expect(harness.getLatestSocket).toHaveBeenCalledOnce();
    expect(harness.getLatestSocket).toHaveBeenCalledWith(CALLER_ID);
    expect(harness.socketTo).toHaveBeenCalledOnce();
    expect(harness.socketTo).toHaveBeenCalledWith("caller-latest-socket");
    expect(harness.socketRelayEmit).toHaveBeenCalledWith(Events.NEGO_FINAL, {
      answer,
      calleeId: CALLEE_ID,
      callHistoryId: CALL_ID,
    });
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(harness.socketEmit).not.toHaveBeenCalled();
    expect(mocks.callHistoryUpdate).not.toHaveBeenCalled();
    expect(mocks.logServerError).not.toHaveBeenCalled();
  });

  it("persists interruption before CALLER_OFFLINE then CALL_END when the peer is offline", async () => {
    const { limiter } = createLimiter();
    const harness = createHarness({ actorId: CALLEE_ID, limiter });

    await harness.trigger(Events.NEGO_DONE, negotiationDonePayload());

    expect(harness.getLatestSocket).toHaveBeenCalledWith(CALLER_ID);
    expect(mocks.callHistoryUpdate).toHaveBeenCalledWith({
      where: { id: CALL_ID },
      data: {
        status: "INTERRUPTED",
        endedAt: NOW,
        duration: 5,
      },
    });
    expect(harness.socketEmit).toHaveBeenNthCalledWith(1, Events.CALLER_OFFLINE);
    expect(harness.socketEmit).toHaveBeenNthCalledWith(2, Events.CALL_END);
    expect(mocks.callHistoryUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      harness.socketEmit.mock.invocationCallOrder[0],
    );
    expect(harness.socketEmit.mock.invocationCallOrder[0]).toBeLessThan(
      harness.socketEmit.mock.invocationCallOrder[1],
    );
    expect(harness.socketTo).not.toHaveBeenCalled();
    expect(harness.ioTo).not.toHaveBeenCalled();
    expect(mocks.logServerError).not.toHaveBeenCalled();
  });
});

describe("WebRTC negotiation participant-role compatibility", () => {
  it("allows the recorded callee to initiate NEGO_NEEDED toward the recorded caller", async () => {
    const directory = createTestConnectionDirectory();
    directory.addSocket(CALLER_ID, "caller-socket");
    const harness = createHarness({ actorId: CALLEE_ID, directory });

    await harness.trigger(Events.NEGO_NEEDED, negotiationNeededPayload(CALLER_ID));

    expect(harness.getLatestSocket).toHaveBeenCalledWith(CALLER_ID);
    expect(harness.socketTo).toHaveBeenCalledWith("caller-socket");
    expect(harness.socketRelayEmit).toHaveBeenCalledWith(Events.NEGO_NEEDED, {
      offer,
      callerId: CALLEE_ID,
      callHistoryId: CALL_ID,
    });
    expect(mocks.callHistoryUpdate).not.toHaveBeenCalled();
    expect(mocks.logServerError).not.toHaveBeenCalled();
  });

  it("allows the recorded caller to send NEGO_DONE toward the recorded callee", async () => {
    const directory = createTestConnectionDirectory();
    directory.addSocket(CALLEE_ID, "callee-socket");
    const harness = createHarness({ actorId: CALLER_ID, directory });

    await harness.trigger(Events.NEGO_DONE, negotiationDonePayload(CALLEE_ID));

    expect(harness.getLatestSocket).toHaveBeenCalledWith(CALLEE_ID);
    expect(harness.socketTo).toHaveBeenCalledWith("callee-socket");
    expect(harness.socketRelayEmit).toHaveBeenCalledWith(Events.NEGO_FINAL, {
      answer,
      calleeId: CALLER_ID,
      callHistoryId: CALL_ID,
    });
    expect(mocks.callHistoryUpdate).not.toHaveBeenCalled();
    expect(mocks.logServerError).not.toHaveBeenCalled();
  });
});

describe("WebRTC negotiation delivery failure boundaries", () => {
  it.each([
    {
      actorId: CALLER_ID,
      event: Events.ICE_CANDIDATE,
      failureLog: "socket.ice_candidate.failed",
      operation: "ice_candidate",
      payload: icePayload,
      targetId: CALLEE_ID,
      transport: "io" as const,
    },
    {
      actorId: CALLER_ID,
      event: Events.NEGO_NEEDED,
      failureLog: "socket.negotiation_needed.failed",
      operation: "negotiation_needed",
      payload: negotiationNeededPayload,
      targetId: CALLEE_ID,
      transport: "socket" as const,
    },
    {
      actorId: CALLEE_ID,
      event: Events.NEGO_DONE,
      failureLog: "socket.negotiation_done.failed",
      operation: "negotiation_done",
      payload: negotiationDonePayload,
      targetId: CALLER_ID,
      transport: "socket" as const,
    },
  ])("logs the exact $event boundary when its $transport relay throws", async ({
    actorId,
    event,
    failureLog,
    operation,
    payload,
    targetId,
    transport,
  }) => {
    const deliveryError = new Error(`${event} delivery failed`);
    const directory = createTestConnectionDirectory();
    directory.addSocket(targetId, "target-socket");
    const ioRelayEmit = vi.fn(() => {
      if (transport === "io") throw deliveryError;
    });
    const socketRelayEmit = vi.fn(() => {
      if (transport === "socket") throw deliveryError;
    });
    const harness = createHarness({
      actorId,
      directory,
      ioRelayEmit,
      socketRelayEmit,
    });

    await harness.trigger(event, payload());

    expect(mocks.logServerError).toHaveBeenCalledOnce();
    expect(mocks.logServerError).toHaveBeenCalledWith(failureLog, {
      operation, result: "failed", errorType: "Error",
    });
    expect(mocks.callHistoryUpdate).not.toHaveBeenCalled();
    expect(harness.socketEmit).not.toHaveBeenCalled();
    expect(harness.metrics.socketOperationFailures).toEqual([operation]);
  });

  it.each([
    {
      actorId: CALLER_ID,
      event: Events.NEGO_NEEDED,
      failureLog: "socket.negotiation_needed.failed",
      operation: "negotiation_needed",
      firstOfflineEvent: Events.CALLEE_OFFLINE,
      payload: negotiationNeededPayload,
    },
    {
      actorId: CALLEE_ID,
      event: Events.NEGO_DONE,
      failureLog: "socket.negotiation_done.failed",
      operation: "negotiation_done",
      firstOfflineEvent: Events.CALLER_OFFLINE,
      payload: negotiationDonePayload,
    },
  ])("keeps the $event update but cuts off CALL_END when the first offline emit throws", async ({
    actorId,
    event,
    failureLog,
    firstOfflineEvent,
    operation,
    payload,
  }) => {
    const deliveryError = new Error(`${event} offline delivery failed`);
    const socketEmit = vi.fn((emittedEvent: Events) => {
      if (emittedEvent === firstOfflineEvent) throw deliveryError;
    });
    const harness = createHarness({ actorId, socketEmit });

    await harness.trigger(event, payload());

    expect(mocks.callHistoryUpdate).toHaveBeenCalledWith({
      where: { id: CALL_ID },
      data: {
        status: "INTERRUPTED",
        endedAt: NOW,
        duration: 5,
      },
    });
    expect(socketEmit).toHaveBeenCalledOnce();
    expect(socketEmit).toHaveBeenCalledWith(firstOfflineEvent);
    expect(socketEmit).not.toHaveBeenCalledWith(Events.CALL_END);
    expect(mocks.callHistoryUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      socketEmit.mock.invocationCallOrder[0],
    );
    expect(mocks.logServerError).toHaveBeenCalledWith(failureLog, {
      operation, result: "failed", errorType: "Error",
    });
  });
});
