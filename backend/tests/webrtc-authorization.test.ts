import type { Server, Socket } from "socket.io";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { MAX_SOCKET_ICE_CANDIDATE_LENGTH, MAX_SOCKET_SDP_LENGTH } from "../src/schemas/socket.schema.js";
import type { SocketConnectionDirectory } from "../src/socket/connection-directory.js";
import { SocketEventRateLimiter } from "../src/socket/socket-security.js";
import registerWebRtcHandlers from "../src/socket/webrtc/socket.js";
import { sendPushNotification } from "../src/modules/notifications/push-notification.service.js";

const CALLER_ID = "cm10000000000000000000001";
const CALLEE_ID = "cm10000000000000000000002";
const CALL_ID = "cm10000000000000000000003";
const FOREIGN_ID = "cm10000000000000000000004";
const FOREIGN_CALL_ID = "cm10000000000000000000005";
const startedAt = new Date(Date.now() - 5_000);
const socketIdsByUser = new Map<string, string[]>();
const getLatestSocket = vi.fn(async (userId: string) => {
  const socketIds = socketIdsByUser.get(userId);
  return socketIds?.[socketIds.length - 1];
});
const directory = { getLatestSocket } as unknown as SocketConnectionDirectory;

const addSocket = (userId: string, socketId: string) => {
  socketIdsByUser.set(userId, [...(socketIdsByUser.get(userId) ?? []), socketId]);
};

const userFindUnique = vi.mocked(prisma.user.findUnique);
const friendFindFirst = vi.mocked(prisma.friends.findFirst);
const callFindFirst = vi.mocked(prisma.callHistory.findFirst);
const callCreate = vi.mocked(prisma.callHistory.create);
const callUpdate = vi.mocked(prisma.callHistory.update);
const pushNotification = vi.mocked(sendPushNotification);

const callRecord = ({
  callerId = CALLER_ID,
  calleeId = CALLEE_ID,
  status = "RINGING",
  endedAt = null,
}: {
  callerId?: string;
  calleeId?: string;
  status?: "RINGING" | "COMPLETED" | "MISSED" | "REJECTED" | "INTERRUPTED";
  endedAt?: Date | null;
} = {}) => ({
  id: CALL_ID,
  callerId,
  calleeId,
  startedAt,
  endedAt,
  status,
});

type EventHandler = (payload: Record<string, unknown>) => Promise<void> | void;

const createHarness = (actorUserId: string) => {
  const handlers = new Map<string, EventHandler>();
  const socketEmit = vi.fn();
  const socketRelayEmit = vi.fn();
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
    to: vi.fn(() => ({ emit: socketRelayEmit })),
    disconnect: vi.fn(),
  };
  const io = {
    to: ioTo,
  };

  registerWebRtcHandlers(socket as unknown as Socket, io as unknown as Server, {
    directory,
    limiter: new SocketEventRateLimiter(),
  });

  return {
    ioRelayEmit,
    ioTo,
    socket,
    socketEmit,
    socketRelayEmit,
    trigger: async (event: Events, payload: Record<string, unknown>) => {
      const handler = handlers.get(event);
      expect(handler).toBeDefined();
      await handler!(payload);
    },
  };
};

const expectNoMutationOrRelay = (harness: ReturnType<typeof createHarness>) => {
  expect(callCreate).not.toHaveBeenCalled();
  expect(callUpdate).not.toHaveBeenCalled();
  expect(harness.socketEmit).not.toHaveBeenCalled();
  expect(harness.socketRelayEmit).not.toHaveBeenCalled();
  expect(harness.ioRelayEmit).not.toHaveBeenCalled();
  expect(harness.socket.disconnect).not.toHaveBeenCalled();
};

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  socketIdsByUser.clear();
});

describe("WebRTC call authorization failures", () => {
  it("prevents a user from calling themselves", async () => {
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.CALL_USER, {
      calleeId: CALLER_ID,
      offer: { type: "offer", sdp: "self" },
    });

    expect(userFindUnique).not.toHaveBeenCalled();
    expectNoMutationOrRelay(harness);
  });

  it("prevents calling a user without an existing friendship", async () => {
    userFindUnique.mockResolvedValue({
      id: CALLEE_ID,
      notificationsEnabled: false,
      fcmToken: null,
    } as never);
    friendFindFirst.mockResolvedValue(null);
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.CALL_USER, {
      calleeId: CALLEE_ID,
      offer: { type: "offer", sdp: "unauthorized" },
    });

    expect(friendFindFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { user1Id: CALLER_ID, user2Id: CALLEE_ID },
          { user1Id: CALLEE_ID, user2Id: CALLER_ID },
        ],
      },
      select: { id: true },
    });
    expectNoMutationOrRelay(harness);
  });

  it("prevents a non-callee from accepting a call", async () => {
    callFindFirst.mockResolvedValue(null);
    const harness = createHarness(FOREIGN_ID);

    await harness.trigger(Events.CALL_ACCEPTED, {
      callerId: CALLER_ID,
      callHistoryId: CALL_ID,
      answer: { type: "answer", sdp: "answer" },
    });

    expectNoMutationOrRelay(harness);
  });

  it("rejects a mismatched caller payload during acceptance", async () => {
    callFindFirst.mockResolvedValue(callRecord() as never);
    const harness = createHarness(CALLEE_ID);

    await harness.trigger(Events.CALL_ACCEPTED, {
      callerId: FOREIGN_ID,
      callHistoryId: CALL_ID,
      answer: { type: "answer", sdp: "answer" },
    });

    expectNoMutationOrRelay(harness);
  });

  it("prevents a non-callee from rejecting a call", async () => {
    callFindFirst.mockResolvedValue(callRecord() as never);
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.CALL_REJECTED, { callHistoryId: CALL_ID });

    expectNoMutationOrRelay(harness);
  });

  it("prevents a nonparticipant from ending a call", async () => {
    callFindFirst.mockResolvedValue(null);
    const harness = createHarness(FOREIGN_ID);

    await harness.trigger(Events.CALL_END, { callHistoryId: CALL_ID });

    expectNoMutationOrRelay(harness);
  });

  it("derives a ringing call as missed from authoritative call state", async () => {
    callFindFirst.mockResolvedValue(callRecord() as never);
    callUpdate.mockResolvedValue({} as never);
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.CALL_END, {
      callHistoryId: CALL_ID,
    });

    expect(callUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: CALL_ID },
      data: expect.objectContaining({ status: "MISSED" }),
    }));
    expect(callUpdate).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ wasCallAccepted: true }),
    }));
  });

  it("CALLEE_BUSY rejects a foreign call ID", async () => {
    callFindFirst.mockResolvedValue(null);
    const harness = createHarness(CALLEE_ID);

    await harness.trigger(Events.CALLEE_BUSY, { callHistoryId: FOREIGN_CALL_ID });

    expectNoMutationOrRelay(harness);
  });

  it("prevents the recorded caller from impersonating the callee as busy", async () => {
    callFindFirst.mockResolvedValue(callRecord() as never);
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.CALLEE_BUSY, { callHistoryId: CALL_ID });

    expectNoMutationOrRelay(harness);
  });

  it("prevents ICE relay by a nonparticipant", async () => {
    callFindFirst.mockResolvedValue(null);
    const harness = createHarness(FOREIGN_ID);

    await harness.trigger(Events.ICE_CANDIDATE, {
      callHistoryId: CALL_ID,
      calleeId: CALLEE_ID,
      candidate: { candidate: "candidate" },
    });

    expectNoMutationOrRelay(harness);
  });

  it("prevents ICE relay to anyone except the other call participant", async () => {
    callFindFirst.mockResolvedValue(callRecord({ status: "COMPLETED" }) as never);
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.ICE_CANDIDATE, {
      callHistoryId: CALL_ID,
      calleeId: FOREIGN_ID,
      candidate: { candidate: "candidate" },
    });

    expectNoMutationOrRelay(harness);
  });

  it("rejects ICE signaling before acceptance or after a terminal transition", async () => {
    callFindFirst.mockResolvedValue(callRecord({ status: "RINGING" }) as never);
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.ICE_CANDIDATE, {
      callHistoryId: CALL_ID,
      calleeId: CALLEE_ID,
      candidate: { candidate: "candidate" },
    });

    expectNoMutationOrRelay(harness);
  });

  it("prevents a nonparticipant from requesting negotiation", async () => {
    callFindFirst.mockResolvedValue(null);
    const harness = createHarness(FOREIGN_ID);

    await harness.trigger(Events.NEGO_NEEDED, {
      callHistoryId: CALL_ID,
      calleeId: CALLEE_ID,
      offer: { type: "offer", sdp: "offer" },
    });

    expectNoMutationOrRelay(harness);
  });

  it("rejects negotiation requests targeting anyone except the other participant", async () => {
    callFindFirst.mockResolvedValue(callRecord({ status: "COMPLETED" }) as never);
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.NEGO_NEEDED, {
      callHistoryId: CALL_ID,
      calleeId: FOREIGN_ID,
      offer: { type: "offer", sdp: "offer" },
    });

    expectNoMutationOrRelay(harness);
  });

  it.each([
    ["nonparticipant", FOREIGN_ID, null, CALLER_ID],
    ["wrong target", CALLEE_ID, callRecord({ status: "COMPLETED" }), FOREIGN_ID],
  ])("NEGO_DONE rejects a %s", async (_label, actorId, call, targetId) => {
    callFindFirst.mockResolvedValue(call as never);
    const harness = createHarness(actorId);

    await harness.trigger(Events.NEGO_DONE, {
      callHistoryId: CALL_ID,
      callerId: targetId,
      answer: { type: "answer", sdp: "answer" },
    });

    expectNoMutationOrRelay(harness);
  });
});

describe("WebRTC authorized call operations", () => {
  it("sends the expected missed-call notification to an offline callee", async () => {
    userFindUnique.mockResolvedValue({
      id: CALLEE_ID,
      notificationsEnabled: true,
      fcmToken: "callee-token",
    } as never);
    friendFindFirst.mockResolvedValue({ id: "friendship-1" } as never);
    callCreate.mockResolvedValue({ id: CALL_ID } as never);
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.CALL_USER, {
      calleeId: CALLEE_ID,
      offer: { type: "offer", sdp: "offline" },
    });

    expect(pushNotification).toHaveBeenCalledWith({
      recipientToken: "callee-token",
      title: "Missed Call",
      body: `You have missed a call from user-${CALLER_ID}`,
    });
  });

  it("does not notify an offline callee who disabled notifications", async () => {
    userFindUnique.mockResolvedValue({
      id: CALLEE_ID,
      notificationsEnabled: false,
      fcmToken: "callee-token",
    } as never);
    friendFindFirst.mockResolvedValue({ id: "friendship-1" } as never);
    callCreate.mockResolvedValue({ id: CALL_ID } as never);
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.CALL_USER, {
      calleeId: CALLEE_ID,
      offer: { type: "offer", sdp: "offline" },
    });

    expect(pushNotification).not.toHaveBeenCalled();
  });

  it("allows a friend to initiate a call using only socket.user.id as caller", async () => {
    userFindUnique.mockResolvedValue({
      id: CALLEE_ID,
      notificationsEnabled: false,
      fcmToken: null,
    } as never);
    friendFindFirst.mockResolvedValue({ id: "friendship-1" } as never);
    callCreate.mockResolvedValue({ id: CALL_ID } as never);
    addSocket(CALLEE_ID, "callee-socket");
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.CALL_USER, {
      calleeId: CALLEE_ID,
      offer: { type: "offer", sdp: "offer" },
    });

    expect(userFindUnique.mock.invocationCallOrder[0]).toBeLessThan(callCreate.mock.invocationCallOrder[0]);
    expect(friendFindFirst.mock.invocationCallOrder[0]).toBeLessThan(callCreate.mock.invocationCallOrder[0]);
    expect(callCreate).toHaveBeenCalledWith({
      data: { callerId: CALLER_ID, calleeId: CALLEE_ID },
    });
    expect(harness.ioRelayEmit).toHaveBeenCalledWith(Events.INCOMING_CALL, expect.objectContaining({
      caller: expect.objectContaining({ id: CALLER_ID }),
      callHistoryId: CALL_ID,
    }));
  });

  it("allows the recorded callee to accept and transitions the call before relay", async () => {
    callFindFirst.mockResolvedValue(callRecord() as never);
    callUpdate.mockResolvedValue({} as never);
    addSocket(CALLER_ID, "caller-socket");
    const harness = createHarness(CALLEE_ID);

    await harness.trigger(Events.CALL_ACCEPTED, {
      callerId: CALLER_ID,
      callHistoryId: CALL_ID,
      answer: { type: "answer", sdp: "answer" },
    });

    expect(callFindFirst.mock.invocationCallOrder[0]).toBeLessThan(callUpdate.mock.invocationCallOrder[0]);
    expect(callUpdate.mock.invocationCallOrder[0]).toBeLessThan(harness.socketRelayEmit.mock.invocationCallOrder[0]);
    expect(callUpdate).toHaveBeenCalledWith({
      where: { id: CALL_ID },
      data: { status: "COMPLETED" },
    });
    expect(harness.socketRelayEmit).toHaveBeenCalledWith(Events.CALL_ACCEPTED, expect.objectContaining({
      calleeId: CALLEE_ID,
      callHistoryId: CALL_ID,
    }));
  });

  it("allows the recorded callee to reject", async () => {
    callFindFirst.mockResolvedValue(callRecord() as never);
    callUpdate.mockResolvedValue({} as never);
    addSocket(CALLER_ID, "caller-socket");
    const harness = createHarness(CALLEE_ID);

    await harness.trigger(Events.CALL_REJECTED, { callHistoryId: CALL_ID });

    expect(callUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "REJECTED", endedAt: expect.any(Date) }),
    }));
    expect(harness.socketRelayEmit).toHaveBeenCalledWith(Events.CALL_REJECTED);
  });

  it.each([CALLER_ID, CALLEE_ID])("allows participant %s to end an accepted call", async (actorId) => {
    callFindFirst.mockResolvedValue(callRecord({ status: "COMPLETED" }) as never);
    callUpdate.mockResolvedValue({} as never);
    addSocket(CALLER_ID, "caller-socket");
    addSocket(CALLEE_ID, "callee-socket");
    const harness = createHarness(actorId);

    await harness.trigger(Events.CALL_END, {
      callHistoryId: CALL_ID,
    });

    expect(callUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "COMPLETED", endedAt: expect.any(Date) }),
    }));
    expect(harness.ioRelayEmit).toHaveBeenCalledWith(Events.CALL_END);
  });

  it("allows the recorded callee to report busy for the bound call", async () => {
    callFindFirst.mockResolvedValue(callRecord() as never);
    callUpdate.mockResolvedValue({} as never);
    addSocket(CALLER_ID, "caller-socket");
    const harness = createHarness(CALLEE_ID);

    await harness.trigger(Events.CALLEE_BUSY, { callHistoryId: CALL_ID });

    expect(callUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "MISSED" }),
    }));
    expect(harness.socketRelayEmit).toHaveBeenCalledWith(Events.CALLEE_BUSY);
  });

  it.each([
    [CALLER_ID, CALLEE_ID],
    [CALLEE_ID, CALLER_ID],
  ])("allows ICE relay from participant %s to participant %s", async (actorId, targetId) => {
    callFindFirst.mockResolvedValue(callRecord({ status: "COMPLETED" }) as never);
    addSocket(targetId, "target-socket");
    const harness = createHarness(actorId);

    await harness.trigger(Events.ICE_CANDIDATE, {
      callHistoryId: CALL_ID,
      calleeId: targetId,
      candidate: { candidate: "candidate" },
    });

    expect(harness.ioRelayEmit).toHaveBeenCalledWith(Events.ICE_CANDIDATE, {
      callerId: actorId,
      candidate: { candidate: "candidate" },
      callHistoryId: CALL_ID,
    });
  });

  it("allows a valid negotiation request", async () => {
    callFindFirst.mockResolvedValue(callRecord({ status: "COMPLETED" }) as never);
    addSocket(CALLEE_ID, "callee-socket");
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.NEGO_NEEDED, {
      callHistoryId: CALL_ID,
      calleeId: CALLEE_ID,
      offer: { type: "offer", sdp: "offer" },
    });

    expect(harness.socketRelayEmit).toHaveBeenCalledWith(Events.NEGO_NEEDED, {
      offer: { type: "offer", sdp: "offer" },
      callerId: CALLER_ID,
      callHistoryId: CALL_ID,
    });
  });

  it("allows a valid negotiation response", async () => {
    callFindFirst.mockResolvedValue(callRecord({ status: "COMPLETED" }) as never);
    addSocket(CALLER_ID, "caller-socket");
    const harness = createHarness(CALLEE_ID);

    await harness.trigger(Events.NEGO_DONE, {
      callHistoryId: CALL_ID,
      callerId: CALLER_ID,
      answer: { type: "answer", sdp: "answer" },
    });

    expect(harness.socketRelayEmit).toHaveBeenCalledWith(Events.NEGO_FINAL, {
      answer: { type: "answer", sdp: "answer" },
      calleeId: CALLEE_ID,
      callHistoryId: CALL_ID,
    });
  });
});

describe("WebRTC payload and abuse controls", () => {
  it("rejects malformed signaling before authorization or mutation", async () => {
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.CALL_USER, { calleeId: CALLEE_ID });

    expect(harness.socketEmit).toHaveBeenCalledWith(Events.SECURITY_ERROR, {
      category: "INVALID_PAYLOAD",
      event: Events.CALL_USER,
    });
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(callCreate).not.toHaveBeenCalled();
  });

  it("rejects oversized SDP and ICE candidate fields", async () => {
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.CALL_USER, {
      calleeId: CALLEE_ID,
      offer: { type: "offer", sdp: "s".repeat(MAX_SOCKET_SDP_LENGTH + 1) },
    });
    await harness.trigger(Events.ICE_CANDIDATE, {
      callHistoryId: CALL_ID,
      calleeId: CALLEE_ID,
      candidate: { candidate: "c".repeat(MAX_SOCKET_ICE_CANDIDATE_LENGTH + 1) },
    });

    expect(harness.socketEmit).toHaveBeenCalledTimes(2);
    expect(callFindFirst).not.toHaveBeenCalled();
  });

  it("throttles repeated call initiation after friendship authorization", async () => {
    userFindUnique.mockResolvedValue({
      id: CALLEE_ID,
      notificationsEnabled: false,
      fcmToken: null,
    } as never);
    friendFindFirst.mockResolvedValue({ id: "friendship" } as never);
    callCreate.mockResolvedValue({ id: CALL_ID } as never);
    addSocket(CALLEE_ID, "callee-socket");
    const harness = createHarness(CALLER_ID);

    for (let index = 0; index < 4; index += 1) {
      await harness.trigger(Events.CALL_USER, {
        calleeId: CALLEE_ID,
        offer: { type: "offer", sdp: "offer" },
      });
    }

    expect(callCreate).toHaveBeenCalledTimes(3);
    expect(harness.socketEmit).toHaveBeenCalledWith(Events.SECURITY_ERROR, {
      category: "RATE_LIMITED",
      event: Events.CALL_USER,
    });
  });

  it("permits a legitimate ICE burst and throttles an extreme flood", async () => {
    callFindFirst.mockResolvedValue(callRecord({ status: "COMPLETED" }) as never);
    addSocket(CALLEE_ID, "callee-socket");
    const harness = createHarness(CALLER_ID);
    const payload = {
      callHistoryId: CALL_ID,
      calleeId: CALLEE_ID,
      candidate: { candidate: "candidate" },
    };

    for (let index = 0; index < 121; index += 1) {
      await harness.trigger(Events.ICE_CANDIDATE, payload);
    }

    expect(harness.ioRelayEmit).toHaveBeenCalledTimes(120);
    expect(harness.socketEmit).toHaveBeenCalledWith(Events.SECURITY_ERROR, {
      category: "RATE_LIMITED",
      event: Events.ICE_CANDIDATE,
    });
  });

  it("throttles negotiation floods separately from ICE", async () => {
    callFindFirst.mockResolvedValue(callRecord({ status: "COMPLETED" }) as never);
    addSocket(CALLEE_ID, "callee-socket");
    const harness = createHarness(CALLER_ID);
    const payload = {
      callHistoryId: CALL_ID,
      calleeId: CALLEE_ID,
      offer: { type: "offer", sdp: "offer" },
    };

    for (let index = 0; index < 11; index += 1) {
      await harness.trigger(Events.NEGO_NEEDED, payload);
    }

    expect(harness.socketRelayEmit).toHaveBeenCalledTimes(10);
    expect(harness.socketEmit).toHaveBeenCalledWith(Events.SECURITY_ERROR, {
      category: "RATE_LIMITED",
      event: Events.NEGO_NEEDED,
    });
  });

  it("rings only the most-recent callee socket under the single-target call policy", async () => {
    userFindUnique.mockResolvedValue({
      id: CALLEE_ID,
      notificationsEnabled: false,
      fcmToken: null,
    } as never);
    friendFindFirst.mockResolvedValue({ id: "friendship" } as never);
    callCreate.mockResolvedValue({ id: CALL_ID } as never);
    addSocket(CALLEE_ID, "older-callee-socket");
    addSocket(CALLEE_ID, "newer-callee-socket");
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.CALL_USER, {
      calleeId: CALLEE_ID,
      offer: { type: "offer", sdp: "offer" },
    });

    expect(harness.ioTo).toHaveBeenCalledWith("newer-callee-socket");
    expect(harness.ioTo).not.toHaveBeenCalledWith("older-callee-socket");
  });
});
