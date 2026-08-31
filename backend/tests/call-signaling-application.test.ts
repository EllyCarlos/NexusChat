import { describe, expect, it, vi } from "vitest";

import { CustomError } from "../src/errors/application-error.js";
import {
  assertActiveCall,
  assertOtherParticipant,
  assertRingingCall,
  assertTerminableCall,
  createCallSignalingService,
  type CallClock,
  type CallSignalingService,
} from "../src/modules/calls/application/call-signaling.service.js";
import type { CallHistoryRepository } from "../src/modules/calls/contracts/call-history.repository.js";
import type { CallPeerLocatorPort } from "../src/modules/calls/contracts/call-peer-locator.port.js";
import type { CallRealtimePort } from "../src/modules/calls/contracts/call-realtime.port.js";
import type {
  CallActor,
  CallAnswer,
  CallablePeer,
  CallOffer,
  CallRecord,
  SerializedIceCandidate,
} from "../src/modules/calls/contracts/call.types.js";
import type { MissedCallNotificationPort } from "../src/modules/calls/contracts/missed-call-notification.port.js";

const ACTOR_ID = "actor-user";
const CALLER_ID = "caller-user";
const CALLEE_ID = "callee-user";
const CALL_ID = "call-history-1";
const CALLER_SOCKET_ID = "caller-socket";
const CALLEE_SOCKET_ID = "callee-socket";
const STARTED_AT = new Date("2026-08-29T10:00:00.000Z");
const ENDED_AT = new Date("2026-08-29T10:01:30.999Z");

const actor: CallActor = {
  id: ACTOR_ID,
  username: "caller-name",
  avatar: "caller-avatar",
};

const callee: CallablePeer = {
  id: CALLEE_ID,
  notificationsEnabled: true,
  notificationRecipientToken: "opaque-recipient-token",
};

const offer: CallOffer = { type: "offer", sdp: "offer-sdp" };
const answer: CallAnswer = { type: "answer", sdp: "answer-sdp" };
const candidate: SerializedIceCandidate = {
  candidate: "candidate-value",
  sdpMid: "0",
  sdpMLineIndex: 0,
  usernameFragment: null,
};

const callRecord = (
  overrides: Partial<CallRecord> = {},
): CallRecord => ({
  id: CALL_ID,
  callerId: CALLER_ID,
  calleeId: CALLEE_ID,
  startedAt: STARTED_AT,
  endedAt: null,
  status: "RINGING",
  ...overrides,
});

const createHistory = (): CallHistoryRepository => ({
  create: vi.fn<CallHistoryRepository["create"]>()
    .mockResolvedValue({ id: CALL_ID }),
  update: vi.fn<CallHistoryRepository["update"]>()
    .mockResolvedValue(undefined),
});

const createPeers = (): CallPeerLocatorPort => ({
  getLatestSocketId: vi.fn<CallPeerLocatorPort["getLatestSocketId"]>(),
});

const createRealtime = (): CallRealtimePort => ({
  emitCallIdToActor: vi.fn<CallRealtimePort["emitCallIdToActor"]>(),
  emitCallEndToActor: vi.fn<CallRealtimePort["emitCallEndToActor"]>(),
  emitCalleeOfflineToActor: vi.fn<CallRealtimePort["emitCalleeOfflineToActor"]>(),
  emitCallerOfflineToActor: vi.fn<CallRealtimePort["emitCallerOfflineToActor"]>(),
  emitIncomingCall: vi.fn<CallRealtimePort["emitIncomingCall"]>(),
  emitCallAccepted: vi.fn<CallRealtimePort["emitCallAccepted"]>(),
  emitCallRejected: vi.fn<CallRealtimePort["emitCallRejected"]>(),
  emitCallEndToPeerViaSocket: vi.fn<CallRealtimePort["emitCallEndToPeerViaSocket"]>(),
  emitCallEndToPeerViaServer: vi.fn<CallRealtimePort["emitCallEndToPeerViaServer"]>(),
  emitCalleeBusy: vi.fn<CallRealtimePort["emitCalleeBusy"]>(),
  emitIceCandidate: vi.fn<CallRealtimePort["emitIceCandidate"]>(),
  emitNegotiationNeeded: vi.fn<CallRealtimePort["emitNegotiationNeeded"]>(),
  emitNegotiationFinal: vi.fn<CallRealtimePort["emitNegotiationFinal"]>(),
});

type CallOrderMock = {
  mock: {
    invocationCallOrder: number[];
  };
};

const firstCallOrder = (mock: CallOrderMock): number =>
  mock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;

const expectCalledBefore = (
  first: CallOrderMock,
  second: CallOrderMock,
): void => {
  expect(firstCallOrder(first)).toBeLessThan(firstCallOrder(second));
};

interface TestHarness {
  service: CallSignalingService;
  history: CallHistoryRepository;
  peers: CallPeerLocatorPort;
  realtime: CallRealtimePort;
  notifyMissedCall: ReturnType<typeof vi.fn<MissedCallNotificationPort>>;
  clock: ReturnType<typeof vi.fn<CallClock>>;
}

const createHarness = (): TestHarness => {
  const history = createHistory();
  const peers = createPeers();
  const realtime = createRealtime();
  const notifyMissedCall = vi.fn<MissedCallNotificationPort>();
  const clock = vi.fn<CallClock>().mockReturnValue(ENDED_AT);
  const service = createCallSignalingService({
    history,
    peers,
    realtime,
    notifyMissedCall,
    clock,
  });

  return { service, history, peers, realtime, notifyMissedCall, clock };
};

const expectGuardError = (
  action: () => void,
  message: string,
  statusCode: number,
): void => {
  try {
    action();
    throw new Error("Expected guard to throw");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(CustomError);
    expect(error).toMatchObject({ message, statusCode });
  }
};

describe("call signaling state guards", () => {
  it("preserves ringing, active, and terminal state meanings and errors", () => {
    expect(() => assertRingingCall(callRecord())).not.toThrow();
    expect(() => assertActiveCall(callRecord({ status: "COMPLETED" }))).not.toThrow();
    expect(() => assertTerminableCall(callRecord())).not.toThrow();

    expectGuardError(
      () => assertRingingCall(callRecord({ status: "COMPLETED" })),
      "Call is not awaiting an answer",
      409,
    );
    expectGuardError(
      () => assertActiveCall(callRecord({ status: "COMPLETED", endedAt: ENDED_AT })),
      "Call is not active",
      409,
    );
    expectGuardError(
      () => assertTerminableCall(callRecord({ status: "REJECTED" })),
      "Call is already terminal",
      409,
    );
  });

  it("derives the authoritative other participant symmetrically", () => {
    const call = callRecord();

    expect(assertOtherParticipant(call, CALLER_ID, CALLEE_ID)).toBe(CALLEE_ID);
    expect(assertOtherParticipant(call, CALLEE_ID, CALLER_ID)).toBe(CALLER_ID);
    expectGuardError(
      () => assertOtherParticipant(call, CALLER_ID, "unrelated-user"),
      "Call participant mismatch",
      403,
    );
  });
});

describe("call signaling application workflows", () => {
  it("keeps offline call initiation emits before timestamp, missed write, and eligible push", async () => {
    const {
      service,
      history,
      peers,
      realtime,
      notifyMissedCall,
      clock,
    } = createHarness();

    await service.callUser({ actor, callee, offer });

    expect(peers.getLatestSocketId).toHaveBeenCalledWith(CALLEE_ID);
    expect(realtime.emitCalleeOfflineToActor).toHaveBeenCalledOnce();
    expect(realtime.emitCallEndToActor).toHaveBeenCalledOnce();
    expect(clock).toHaveBeenCalledOnce();
    expect(history.create).toHaveBeenCalledWith({
      kind: "missed",
      callerId: ACTOR_ID,
      calleeId: CALLEE_ID,
      endedAt: ENDED_AT,
      duration: 0,
    });
    expect(notifyMissedCall).toHaveBeenCalledWith({
      recipientToken: "opaque-recipient-token",
      title: "Missed Call",
      body: "You have missed a call from caller-name",
    });
    expectCalledBefore(
      vi.mocked(realtime.emitCalleeOfflineToActor),
      vi.mocked(realtime.emitCallEndToActor),
    );
    expectCalledBefore(vi.mocked(realtime.emitCallEndToActor), clock);
    expectCalledBefore(clock, vi.mocked(history.create));
    expectCalledBefore(vi.mocked(history.create), notifyMissedCall);
    expect(realtime.emitCallIdToActor).not.toHaveBeenCalled();
    expect(realtime.emitIncomingCall).not.toHaveBeenCalled();
  });

  it("creates an online call before CALL_ID and INCOMING_CALL without reading the clock", async () => {
    const { service, history, peers, realtime, notifyMissedCall, clock } = createHarness();
    vi.mocked(peers.getLatestSocketId).mockResolvedValue(CALLEE_SOCKET_ID);

    await service.callUser({ actor, callee, offer });

    expect(history.create).toHaveBeenCalledWith({
      kind: "ringing",
      callerId: ACTOR_ID,
      calleeId: CALLEE_ID,
    });
    expect(realtime.emitCallIdToActor).toHaveBeenCalledWith({
      callHistoryId: CALL_ID,
    });
    expect(realtime.emitIncomingCall).toHaveBeenCalledWith(CALLEE_SOCKET_ID, {
      caller: actor,
      offer,
      callHistoryId: CALL_ID,
    });
    expectCalledBefore(vi.mocked(history.create), vi.mocked(realtime.emitCallIdToActor));
    expectCalledBefore(
      vi.mocked(realtime.emitCallIdToActor),
      vi.mocked(realtime.emitIncomingCall),
    );
    expect(clock).not.toHaveBeenCalled();
    expect(notifyMissedCall).not.toHaveBeenCalled();
  });

  it("retains a created call and cuts off INCOMING_CALL when CALL_ID delivery throws", async () => {
    const { service, history, peers, realtime } = createHarness();
    const deliveryFailure = new Error("CALL_ID delivery failed");
    vi.mocked(peers.getLatestSocketId).mockResolvedValue(CALLEE_SOCKET_ID);
    vi.mocked(realtime.emitCallIdToActor).mockImplementation(() => {
      throw deliveryFailure;
    });

    await expect(service.callUser({ actor, callee, offer })).rejects.toBe(deliveryFailure);

    expect(history.create).toHaveBeenCalledOnce();
    expect(realtime.emitIncomingCall).not.toHaveBeenCalled();
  });

  it("accepts online only after the strict status-only write", async () => {
    const { service, history, peers, realtime, clock } = createHarness();
    vi.mocked(peers.getLatestSocketId).mockResolvedValue(CALLER_SOCKET_ID);
    const call = callRecord();

    await service.acceptCall({ actorId: CALLEE_ID, call, answer });

    expect(history.update).toHaveBeenCalledWith({
      kind: "accepted",
      callHistoryId: CALL_ID,
      data: { status: "COMPLETED" },
    });
    expect(realtime.emitCallAccepted).toHaveBeenCalledWith(CALLER_SOCKET_ID, {
      calleeId: CALLEE_ID,
      answer,
      callHistoryId: CALL_ID,
    });
    expectCalledBefore(vi.mocked(peers.getLatestSocketId), vi.mocked(history.update));
    expectCalledBefore(vi.mocked(history.update), vi.mocked(realtime.emitCallAccepted));
    expect(clock).not.toHaveBeenCalled();
  });

  it("marks an offline caller missed before actor END then CALLER_OFFLINE", async () => {
    const { service, history, peers, realtime, clock } = createHarness();

    await service.acceptCall({
      actorId: CALLEE_ID,
      call: callRecord(),
      answer,
    });

    expect(history.update).toHaveBeenCalledWith({
      kind: "terminal",
      callHistoryId: CALL_ID,
      data: {
        status: "MISSED",
        endedAt: ENDED_AT,
        duration: 90,
      },
    });
    expectCalledBefore(vi.mocked(peers.getLatestSocketId), clock);
    expectCalledBefore(clock, vi.mocked(history.update));
    expectCalledBefore(vi.mocked(history.update), vi.mocked(realtime.emitCallEndToActor));
    expectCalledBefore(
      vi.mocked(realtime.emitCallEndToActor),
      vi.mocked(realtime.emitCallerOfflineToActor),
    );
  });

  it("rejects with one terminal write then peer REJECTED, peer END, and actor END", async () => {
    const { service, history, peers, realtime, clock } = createHarness();
    vi.mocked(peers.getLatestSocketId).mockResolvedValue(CALLER_SOCKET_ID);

    await service.rejectCall({ call: callRecord() });

    expect(history.update).toHaveBeenCalledWith({
      kind: "terminal",
      callHistoryId: CALL_ID,
      data: {
        status: "REJECTED",
        endedAt: ENDED_AT,
        duration: 90,
      },
    });
    expectCalledBefore(clock, vi.mocked(history.update));
    expectCalledBefore(vi.mocked(history.update), vi.mocked(peers.getLatestSocketId));
    expectCalledBefore(vi.mocked(realtime.emitCallRejected), vi.mocked(realtime.emitCallEndToPeerViaSocket));
    expectCalledBefore(vi.mocked(realtime.emitCallEndToPeerViaSocket), vi.mocked(realtime.emitCallEndToActor));
  });

  it("ends an active call before ordered caller/callee server delivery", async () => {
    const { service, history, peers, realtime, clock } = createHarness();
    vi.mocked(peers.getLatestSocketId)
      .mockResolvedValueOnce(CALLER_SOCKET_ID)
      .mockResolvedValueOnce(CALLEE_SOCKET_ID);

    await service.endCall({ call: callRecord({ status: "COMPLETED" }) });

    expect(clock).toHaveBeenCalledOnce();
    expect(history.update).toHaveBeenCalledWith({
      kind: "terminal",
      callHistoryId: CALL_ID,
      data: {
        status: "COMPLETED",
        endedAt: ENDED_AT,
        duration: 90,
      },
    });
    expect(peers.getLatestSocketId).toHaveBeenNthCalledWith(1, CALLER_ID);
    expect(peers.getLatestSocketId).toHaveBeenNthCalledWith(2, CALLEE_ID);
    expect(realtime.emitCallEndToPeerViaServer).toHaveBeenNthCalledWith(
      1,
      CALLER_SOCKET_ID,
    );
    expect(realtime.emitCallEndToPeerViaServer).toHaveBeenNthCalledWith(
      2,
      CALLEE_SOCKET_ID,
    );
    expectCalledBefore(clock, vi.mocked(history.update));
    expectCalledBefore(vi.mocked(history.update), vi.mocked(peers.getLatestSocketId));
  });

  it("does not attempt callee delivery when caller CALL_END delivery throws", async () => {
    const { service, history, peers, realtime } = createHarness();
    const deliveryFailure = new Error("caller END delivery failed");
    vi.mocked(peers.getLatestSocketId)
      .mockResolvedValueOnce(CALLER_SOCKET_ID)
      .mockResolvedValueOnce(CALLEE_SOCKET_ID);
    vi.mocked(realtime.emitCallEndToPeerViaServer).mockImplementation(() => {
      throw deliveryFailure;
    });

    await expect(service.endCall({ call: callRecord() })).rejects.toBe(deliveryFailure);

    expect(history.update).toHaveBeenCalledOnce();
    expect(realtime.emitCallEndToPeerViaServer).toHaveBeenCalledOnce();
    expect(realtime.emitCallEndToPeerViaServer).toHaveBeenCalledWith(CALLER_SOCKET_ID);
  });

  it("marks a busy callee missed before CALLEE_BUSY and peer END", async () => {
    const { service, history, peers, realtime } = createHarness();
    vi.mocked(peers.getLatestSocketId).mockResolvedValue(CALLER_SOCKET_ID);

    await service.markCalleeBusy({ call: callRecord() });

    expect(history.update).toHaveBeenCalledWith({
      kind: "terminal",
      callHistoryId: CALL_ID,
      data: {
        status: "MISSED",
        endedAt: ENDED_AT,
        duration: 90,
      },
    });
    expectCalledBefore(vi.mocked(history.update), vi.mocked(peers.getLatestSocketId));
    expectCalledBefore(vi.mocked(realtime.emitCalleeBusy), vi.mocked(realtime.emitCallEndToPeerViaSocket));
    expect(realtime.emitCallEndToActor).not.toHaveBeenCalled();
  });

  it("silently drops offline ICE and relays the exact online candidate without persistence", async () => {
    const { service, history, peers, realtime } = createHarness();
    vi.mocked(peers.getLatestSocketId)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(CALLEE_SOCKET_ID);
    const call = callRecord({ status: "COMPLETED" });
    const input = { actorId: CALLER_ID, call, targetUserId: CALLEE_ID, candidate };

    await service.relayIceCandidate(input);
    await service.relayIceCandidate(input);

    expect(history.create).not.toHaveBeenCalled();
    expect(history.update).not.toHaveBeenCalled();
    expect(realtime.emitIceCandidate).toHaveBeenCalledOnce();
    expect(realtime.emitIceCandidate).toHaveBeenCalledWith(CALLEE_SOCKET_ID, {
      callerId: CALLER_ID,
      candidate,
      callHistoryId: CALL_ID,
    });
  });

  it("interrupts offline negotiation-needed before CALLEE_OFFLINE then actor END", async () => {
    const { service, history, realtime, clock } = createHarness();
    const call = callRecord({ status: "COMPLETED" });

    await service.relayNegotiationNeeded({
      actorId: CALLER_ID,
      call,
      targetUserId: CALLEE_ID,
      offer,
    });

    expect(history.update).toHaveBeenCalledWith({
      kind: "terminal",
      callHistoryId: CALL_ID,
      data: {
        status: "INTERRUPTED",
        endedAt: ENDED_AT,
        duration: 90,
      },
    });
    expectCalledBefore(clock, vi.mocked(history.update));
    expectCalledBefore(vi.mocked(history.update), vi.mocked(realtime.emitCalleeOfflineToActor));
    expectCalledBefore(vi.mocked(realtime.emitCalleeOfflineToActor), vi.mocked(realtime.emitCallEndToActor));
    expect(realtime.emitCallerOfflineToActor).not.toHaveBeenCalled();
  });

  it("interrupts offline negotiation-done before CALLER_OFFLINE then actor END", async () => {
    const { service, history, realtime } = createHarness();
    const call = callRecord({ status: "COMPLETED" });

    await service.relayNegotiationDone({
      actorId: CALLEE_ID,
      call,
      targetUserId: CALLER_ID,
      answer,
    });

    expect(history.update).toHaveBeenCalledWith({
      kind: "terminal",
      callHistoryId: CALL_ID,
      data: {
        status: "INTERRUPTED",
        endedAt: ENDED_AT,
        duration: 90,
      },
    });
    expectCalledBefore(vi.mocked(history.update), vi.mocked(realtime.emitCallerOfflineToActor));
    expectCalledBefore(vi.mocked(realtime.emitCallerOfflineToActor), vi.mocked(realtime.emitCallEndToActor));
    expect(realtime.emitCalleeOfflineToActor).not.toHaveBeenCalled();
  });

  it("relays both online negotiation directions with their asymmetric payload names", async () => {
    const { service, history, peers, realtime, clock } = createHarness();
    vi.mocked(peers.getLatestSocketId)
      .mockResolvedValueOnce(CALLEE_SOCKET_ID)
      .mockResolvedValueOnce(CALLER_SOCKET_ID);
    const call = callRecord({ status: "COMPLETED" });

    await service.relayNegotiationNeeded({
      actorId: CALLER_ID,
      call,
      targetUserId: CALLEE_ID,
      offer,
    });
    await service.relayNegotiationDone({
      actorId: CALLEE_ID,
      call,
      targetUserId: CALLER_ID,
      answer,
    });

    expect(realtime.emitNegotiationNeeded).toHaveBeenCalledWith(CALLEE_SOCKET_ID, {
      offer,
      callerId: CALLER_ID,
      callHistoryId: CALL_ID,
    });
    expect(realtime.emitNegotiationFinal).toHaveBeenCalledWith(CALLER_SOCKET_ID, {
      answer,
      calleeId: CALLEE_ID,
      callHistoryId: CALL_ID,
    });
    expect(history.update).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
  });
});
