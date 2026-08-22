import type { Server, Socket } from "socket.io";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/index.js", () => ({
  userSocketIds: new Map<string, string>(),
}));

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

vi.mock("../src/utils/generic.js", () => ({
  sendPushNotification: vi.fn(),
}));

import { Events } from "../src/enums/event/event.enum.js";
import { userSocketIds } from "../src/index.js";
import { prisma } from "../src/lib/prisma.lib.js";
import registerWebRtcHandlers from "../src/socket/webrtc/socket.js";

const CALLER_ID = "caller-user";
const CALLEE_ID = "callee-user";
const CALL_ID = "call-1";
const startedAt = new Date(Date.now() - 5_000);

const userFindUnique = vi.mocked(prisma.user.findUnique);
const friendFindFirst = vi.mocked(prisma.friends.findFirst);
const callFindFirst = vi.mocked(prisma.callHistory.findFirst);
const callCreate = vi.mocked(prisma.callHistory.create);
const callUpdate = vi.mocked(prisma.callHistory.update);

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
    to: vi.fn(() => ({ emit: ioRelayEmit })),
  };

  registerWebRtcHandlers(socket as unknown as Socket, io as unknown as Server);

  return {
    ioRelayEmit,
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
  userSocketIds.clear();
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
    const harness = createHarness("foreign-user");

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
      callerId: "attacker-target",
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
    const harness = createHarness("foreign-user");

    await harness.trigger(Events.CALL_END, {
      callHistoryId: CALL_ID,
      wasCallAccepted: true,
    });

    expectNoMutationOrRelay(harness);
  });

  it("ignores client acceptance claims and derives a ringing call as missed", async () => {
    callFindFirst.mockResolvedValue(callRecord() as never);
    callUpdate.mockResolvedValue({} as never);
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.CALL_END, {
      callHistoryId: CALL_ID,
      wasCallAccepted: true,
    });

    expect(callUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: CALL_ID },
      data: expect.objectContaining({ status: "MISSED" }),
    }));
    expect(callUpdate).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ wasCallAccepted: true }),
    }));
  });

  it.each([
    ["missing binding", CALLEE_ID, {}],
    ["foreign call ID", CALLEE_ID, { callHistoryId: "foreign-call" }],
  ])("CALLEE_BUSY rejects %s", async (_label, actorId, payload) => {
    callFindFirst.mockResolvedValue(null);
    const harness = createHarness(actorId);

    await harness.trigger(Events.CALLEE_BUSY, payload);

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
    const harness = createHarness("foreign-user");

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
      calleeId: "arbitrary-user",
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
    const harness = createHarness("foreign-user");

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
      calleeId: "arbitrary-user",
      offer: { type: "offer", sdp: "offer" },
    });

    expectNoMutationOrRelay(harness);
  });

  it.each([
    ["nonparticipant", "foreign-user", null, CALLER_ID],
    ["wrong target", CALLEE_ID, callRecord({ status: "COMPLETED" }), "arbitrary-user"],
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
  it("allows a friend to initiate a call using only socket.user.id as caller", async () => {
    userFindUnique.mockResolvedValue({
      id: CALLEE_ID,
      notificationsEnabled: false,
      fcmToken: null,
    } as never);
    friendFindFirst.mockResolvedValue({ id: "friendship-1" } as never);
    callCreate.mockResolvedValue({ id: CALL_ID } as never);
    userSocketIds.set(CALLEE_ID, "callee-socket");
    const harness = createHarness(CALLER_ID);

    await harness.trigger(Events.CALL_USER, {
      calleeId: CALLEE_ID,
      callerId: "attacker-user",
      userId: "attacker-user",
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
    userSocketIds.set(CALLER_ID, "caller-socket");
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
    userSocketIds.set(CALLER_ID, "caller-socket");
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
    userSocketIds.set(CALLER_ID, "caller-socket");
    userSocketIds.set(CALLEE_ID, "callee-socket");
    const harness = createHarness(actorId);

    await harness.trigger(Events.CALL_END, {
      callHistoryId: CALL_ID,
      wasCallAccepted: false,
    });

    expect(callUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "COMPLETED", endedAt: expect.any(Date) }),
    }));
    expect(harness.ioRelayEmit).toHaveBeenCalledWith(Events.CALL_END);
  });

  it("allows the recorded callee to report busy for the bound call", async () => {
    callFindFirst.mockResolvedValue(callRecord() as never);
    callUpdate.mockResolvedValue({} as never);
    userSocketIds.set(CALLER_ID, "caller-socket");
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
    userSocketIds.set(targetId, "target-socket");
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
    userSocketIds.set(CALLEE_ID, "callee-socket");
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
    userSocketIds.set(CALLER_ID, "caller-socket");
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
