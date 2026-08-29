import type { Server, Socket } from "socket.io";
import { describe, expect, it, vi } from "vitest";
import { Events } from "../src/enums/event/event.enum.js";
import type { CallRealtimePort } from "../src/modules/calls/contracts/call-realtime.port.js";
import type {
  CallAcceptedPayload,
  CallIdPayload,
  IceCandidatePayload,
  IncomingCallPayload,
  NegotiationFinalPayload,
  NegotiationNeededPayload,
} from "../src/modules/calls/contracts/call.types.js";
import { createSocketCallRealtimeAdapter } from "../src/modules/calls/infrastructure/socket-call-realtime.adapter.js";

const TARGET_SOCKET_ID = "peer-socket-1";

const callIdPayload = {
  callHistoryId: "call-1",
} satisfies CallIdPayload;

const incomingCallPayload = {
  caller: {
    id: "caller-1",
    username: "trusted-caller",
    avatar: "https://media.example/caller.png",
  },
  offer: {
    type: "offer",
    sdp: "incoming-offer-sdp",
  },
  callHistoryId: "call-1",
} satisfies IncomingCallPayload;

const callAcceptedPayload = {
  calleeId: "callee-1",
  answer: {
    type: "answer",
    sdp: "accepted-answer-sdp",
  },
  callHistoryId: "call-1",
} satisfies CallAcceptedPayload;

const iceCandidatePayload = {
  candidate: {
    candidate: "candidate:1 1 UDP 2122260223 192.0.2.1 54400 typ host",
    sdpMid: "0",
    sdpMLineIndex: 0,
    usernameFragment: "fragment-1",
  },
  callerId: "caller-1",
  callHistoryId: "call-1",
} satisfies IceCandidatePayload;

const negotiationNeededPayload = {
  offer: {
    type: "offer",
    sdp: "negotiation-offer-sdp",
  },
  callerId: "caller-1",
  callHistoryId: "call-1",
} satisfies NegotiationNeededPayload;

const negotiationFinalPayload = {
  answer: {
    type: "answer",
    sdp: "negotiation-answer-sdp",
  },
  calleeId: "callee-1",
  callHistoryId: "call-1",
} satisfies NegotiationFinalPayload;

type AdapterHarness = {
  adapter: CallRealtimePort;
  socketEmit: ReturnType<typeof vi.fn>;
  socketTo: ReturnType<typeof vi.fn>;
  socketPeerEmit: ReturnType<typeof vi.fn>;
  ioTo: ReturnType<typeof vi.fn>;
  serverPeerEmit: ReturnType<typeof vi.fn>;
};

const createHarness = (): AdapterHarness => {
  const socketEmit = vi.fn();
  const socketPeerEmit = vi.fn();
  const socketTo = vi.fn(() => ({ emit: socketPeerEmit }));
  const serverPeerEmit = vi.fn();
  const ioTo = vi.fn(() => ({ emit: serverPeerEmit }));
  const socket = {
    emit: socketEmit,
    to: socketTo,
  } as unknown as Socket;
  const io = { to: ioTo } as unknown as Server;

  return {
    adapter: createSocketCallRealtimeAdapter({ io, socket }),
    socketEmit,
    socketTo,
    socketPeerEmit,
    ioTo,
    serverPeerEmit,
  };
};

type DeliveryCase = {
  name: string;
  event: Events;
  payload?: unknown;
  deliver(adapter: CallRealtimePort): void;
};

const expectExactEmit = (
  emit: ReturnType<typeof vi.fn>,
  event: Events,
  payload?: unknown,
): void => {
  expect(emit.mock.calls).toEqual(
    payload === undefined ? [[event]] : [[event, payload]],
  );
};

describe("Socket call realtime adapter", () => {
  const actorDeliveryCases = [
    {
      name: "CALL_ID with its exact payload",
      event: Events.CALL_ID,
      payload: callIdPayload,
      deliver: (adapter: CallRealtimePort) => adapter.emitCallIdToActor(callIdPayload),
    },
    {
      name: "CALL_END without a payload",
      event: Events.CALL_END,
      deliver: (adapter: CallRealtimePort) => adapter.emitCallEndToActor(),
    },
    {
      name: "CALLEE_OFFLINE without a payload",
      event: Events.CALLEE_OFFLINE,
      deliver: (adapter: CallRealtimePort) => adapter.emitCalleeOfflineToActor(),
    },
    {
      name: "CALLER_OFFLINE without a payload",
      event: Events.CALLER_OFFLINE,
      deliver: (adapter: CallRealtimePort) => adapter.emitCallerOfflineToActor(),
    },
  ] satisfies DeliveryCase[];

  it.each(actorDeliveryCases)(
    "emits $name directly to the actor socket",
    ({ deliver, event, payload }) => {
      const harness = createHarness();

      deliver(harness.adapter);

      expectExactEmit(harness.socketEmit, event, payload);
      expect(harness.socketTo).not.toHaveBeenCalled();
      expect(harness.socketPeerEmit).not.toHaveBeenCalled();
      expect(harness.ioTo).not.toHaveBeenCalled();
      expect(harness.serverPeerEmit).not.toHaveBeenCalled();
    },
  );

  const senderExcludingDeliveryCases = [
    {
      name: "CALL_ACCEPTED with its exact payload",
      event: Events.CALL_ACCEPTED,
      payload: callAcceptedPayload,
      deliver: (adapter: CallRealtimePort) => (
        adapter.emitCallAccepted(TARGET_SOCKET_ID, callAcceptedPayload)
      ),
    },
    {
      name: "CALL_REJECTED without a payload",
      event: Events.CALL_REJECTED,
      deliver: (adapter: CallRealtimePort) => adapter.emitCallRejected(TARGET_SOCKET_ID),
    },
    {
      name: "CALL_END without a payload",
      event: Events.CALL_END,
      deliver: (adapter: CallRealtimePort) => (
        adapter.emitCallEndToPeerViaSocket(TARGET_SOCKET_ID)
      ),
    },
    {
      name: "CALLEE_BUSY without a payload",
      event: Events.CALLEE_BUSY,
      deliver: (adapter: CallRealtimePort) => adapter.emitCalleeBusy(TARGET_SOCKET_ID),
    },
    {
      name: "NEGO_NEEDED with its exact payload",
      event: Events.NEGO_NEEDED,
      payload: negotiationNeededPayload,
      deliver: (adapter: CallRealtimePort) => (
        adapter.emitNegotiationNeeded(TARGET_SOCKET_ID, negotiationNeededPayload)
      ),
    },
    {
      name: "NEGO_FINAL with its exact payload",
      event: Events.NEGO_FINAL,
      payload: negotiationFinalPayload,
      deliver: (adapter: CallRealtimePort) => (
        adapter.emitNegotiationFinal(TARGET_SOCKET_ID, negotiationFinalPayload)
      ),
    },
  ] satisfies DeliveryCase[];

  it.each(senderExcludingDeliveryCases)(
    "emits $name through socket.to so the actor is excluded",
    ({ deliver, event, payload }) => {
      const harness = createHarness();

      deliver(harness.adapter);

      expect(harness.socketTo.mock.calls).toEqual([[TARGET_SOCKET_ID]]);
      expectExactEmit(harness.socketPeerEmit, event, payload);
      expect(harness.socketEmit).not.toHaveBeenCalled();
      expect(harness.ioTo).not.toHaveBeenCalled();
      expect(harness.serverPeerEmit).not.toHaveBeenCalled();
    },
  );

  const serverDirectDeliveryCases = [
    {
      name: "INCOMING_CALL with its exact payload",
      event: Events.INCOMING_CALL,
      payload: incomingCallPayload,
      deliver: (adapter: CallRealtimePort) => (
        adapter.emitIncomingCall(TARGET_SOCKET_ID, incomingCallPayload)
      ),
    },
    {
      name: "CALL_END without a payload",
      event: Events.CALL_END,
      deliver: (adapter: CallRealtimePort) => (
        adapter.emitCallEndToPeerViaServer(TARGET_SOCKET_ID)
      ),
    },
    {
      name: "ICE_CANDIDATE with its exact payload",
      event: Events.ICE_CANDIDATE,
      payload: iceCandidatePayload,
      deliver: (adapter: CallRealtimePort) => (
        adapter.emitIceCandidate(TARGET_SOCKET_ID, iceCandidatePayload)
      ),
    },
  ] satisfies DeliveryCase[];

  it.each(serverDirectDeliveryCases)(
    "emits $name through io.to so delivery includes the addressed socket",
    ({ deliver, event, payload }) => {
      const harness = createHarness();

      deliver(harness.adapter);

      expect(harness.ioTo.mock.calls).toEqual([[TARGET_SOCKET_ID]]);
      expectExactEmit(harness.serverPeerEmit, event, payload);
      expect(harness.socketEmit).not.toHaveBeenCalled();
      expect(harness.socketTo).not.toHaveBeenCalled();
      expect(harness.socketPeerEmit).not.toHaveBeenCalled();
    },
  );

  it("propagates a synchronous actor socket.emit failure", () => {
    const harness = createHarness();
    const deliveryError = new Error("actor delivery failed");
    harness.socketEmit.mockImplementationOnce(() => {
      throw deliveryError;
    });

    expect(() => harness.adapter.emitCallEndToActor()).toThrow(deliveryError);
  });

  it("propagates a synchronous sender-excluding socket.to(...).emit failure", () => {
    const harness = createHarness();
    const deliveryError = new Error("sender-excluding delivery failed");
    harness.socketPeerEmit.mockImplementationOnce(() => {
      throw deliveryError;
    });

    expect(() => (
      harness.adapter.emitCallAccepted(TARGET_SOCKET_ID, callAcceptedPayload)
    )).toThrow(deliveryError);
  });

  it("propagates a synchronous server-direct io.to(...).emit failure", () => {
    const harness = createHarness();
    const deliveryError = new Error("server-direct delivery failed");
    harness.serverPeerEmit.mockImplementationOnce(() => {
      throw deliveryError;
    });

    expect(() => (
      harness.adapter.emitIceCandidate(TARGET_SOCKET_ID, iceCandidatePayload)
    )).toThrow(deliveryError);
  });
});
