import { CustomError } from "../../../errors/application-error.js";
import type { CallHistoryRepository } from "../contracts/call-history.repository.js";
import type { CallPeerLocatorPort } from "../contracts/call-peer-locator.port.js";
import type { CallRealtimePort } from "../contracts/call-realtime.port.js";
import type {
  CallActor,
  CallAnswer,
  CallablePeer,
  CallOffer,
  CallRecord,
  IceCandidatePayload,
  SerializedIceCandidate,
} from "../contracts/call.types.js";
import type { MissedCallNotificationPort } from "../contracts/missed-call-notification.port.js";

export type CallClock = () => Date;

export interface CallSignalingDependencies {
  history: CallHistoryRepository;
  peers: CallPeerLocatorPort;
  realtime: CallRealtimePort;
  notifyMissedCall: MissedCallNotificationPort;
  clock: CallClock;
}

export interface CallUserInput {
  actor: CallActor;
  callee: CallablePeer;
  offer: CallOffer;
}

export interface AcceptCallInput {
  actorId: string;
  call: CallRecord;
  answer: CallAnswer;
}

export interface CallRecordInput {
  call: CallRecord;
}

export interface RelayIceCandidateInput {
  actorId: string;
  call: CallRecord;
  targetUserId: string;
  candidate: SerializedIceCandidate;
}

export interface RelayNegotiationNeededInput {
  actorId: string;
  call: CallRecord;
  targetUserId: string;
  offer: CallOffer;
}

export interface RelayNegotiationDoneInput {
  actorId: string;
  call: CallRecord;
  targetUserId: string;
  answer: CallAnswer;
}

export interface CallSignalingService {
  callUser(input: CallUserInput): Promise<void>;
  acceptCall(input: AcceptCallInput): Promise<void>;
  rejectCall(input: CallRecordInput): Promise<void>;
  endCall(input: CallRecordInput): Promise<void>;
  markCalleeBusy(input: CallRecordInput): Promise<void>;
  relayIceCandidate(input: RelayIceCandidateInput): Promise<void>;
  relayNegotiationNeeded(input: RelayNegotiationNeededInput): Promise<void>;
  relayNegotiationDone(input: RelayNegotiationDoneInput): Promise<void>;
}

export const assertRingingCall = (call: CallRecord): void => {
  if (call.status !== "RINGING" || call.endedAt) {
    throw new CustomError("Call is not awaiting an answer", 409);
  }
};

export const assertActiveCall = (call: CallRecord): void => {
  // The schema has no ACCEPTED state. COMPLETED + endedAt=null represents an
  // accepted active call; endedAt marks its terminal transition.
  if (call.status !== "COMPLETED" || call.endedAt) {
    throw new CustomError("Call is not active", 409);
  }
};

export const assertTerminableCall = (call: CallRecord): void => {
  if (
    call.endedAt
    || (call.status !== "RINGING" && call.status !== "COMPLETED")
  ) {
    throw new CustomError("Call is already terminal", 409);
  }
};

export const assertOtherParticipant = (
  call: CallRecord,
  actorUserId: string,
  suppliedTargetUserId: string,
): string => {
  const otherParticipantId = call.callerId === actorUserId
    ? call.calleeId
    : call.callerId;

  if (suppliedTargetUserId !== otherParticipantId) {
    throw new CustomError("Call participant mismatch", 403);
  }

  return otherParticipantId;
};

const terminalData = (call: CallRecord, clock: CallClock) => {
  const endedAt = clock();
  return {
    endedAt,
    duration: Math.floor(
      (endedAt.getTime() - call.startedAt.getTime()) / 1_000,
    ),
  };
};

export const createCallSignalingService = ({
  history,
  peers,
  realtime,
  notifyMissedCall,
  clock,
}: CallSignalingDependencies): CallSignalingService => ({
  async callUser({ actor, callee, offer }) {
    const calleeSocketId = peers.getLatestSocketId(callee.id);

    if (!calleeSocketId) {
      realtime.emitCalleeOfflineToActor();
      realtime.emitCallEndToActor();

      const endedAt = clock();
      await history.create({
        kind: "missed",
        callerId: actor.id,
        calleeId: callee.id,
        endedAt,
        duration: 0,
      });

      if (callee.notificationsEnabled && callee.notificationRecipientToken) {
        notifyMissedCall({
          recipientToken: callee.notificationRecipientToken,
          title: "Missed Call",
          body: `You have missed a call from ${actor.username}`,
        });
      }
      return;
    }

    const newCall = await history.create({
      kind: "ringing",
      callerId: actor.id,
      calleeId: callee.id,
    });
    realtime.emitCallIdToActor({ callHistoryId: newCall.id });
    realtime.emitIncomingCall(calleeSocketId, {
      caller: {
        id: actor.id,
        username: actor.username,
        avatar: actor.avatar,
      },
      offer,
      callHistoryId: newCall.id,
    });
  },

  async acceptCall({ actorId, call, answer }) {
    const callerSocketId = peers.getLatestSocketId(call.callerId);

    if (!callerSocketId) {
      await history.update({
        kind: "terminal",
        callHistoryId: call.id,
        data: {
          status: "MISSED",
          ...terminalData(call, clock),
        },
      });
      realtime.emitCallEndToActor();
      realtime.emitCallerOfflineToActor();
      return;
    }

    await history.update({
      kind: "accepted",
      callHistoryId: call.id,
      data: { status: "COMPLETED" },
    });
    realtime.emitCallAccepted(callerSocketId, {
      calleeId: actorId,
      answer,
      callHistoryId: call.id,
    });
  },

  async rejectCall({ call }) {
    await history.update({
      kind: "terminal",
      callHistoryId: call.id,
      data: {
        status: "REJECTED",
        ...terminalData(call, clock),
      },
    });

    const callerSocketId = peers.getLatestSocketId(call.callerId);
    if (callerSocketId) {
      realtime.emitCallRejected(callerSocketId);
      realtime.emitCallEndToPeerViaSocket(callerSocketId);
    }
    realtime.emitCallEndToActor();
  },

  async endCall({ call }) {
    const finalStatus = call.status === "RINGING" ? "MISSED" : "COMPLETED";
    await history.update({
      kind: "terminal",
      callHistoryId: call.id,
      data: {
        status: finalStatus,
        ...terminalData(call, clock),
      },
    });

    const callerSocketId = peers.getLatestSocketId(call.callerId);
    const calleeSocketId = peers.getLatestSocketId(call.calleeId);
    if (callerSocketId) {
      realtime.emitCallEndToPeerViaServer(callerSocketId);
    }
    if (calleeSocketId) {
      realtime.emitCallEndToPeerViaServer(calleeSocketId);
    }
  },

  async markCalleeBusy({ call }) {
    await history.update({
      kind: "terminal",
      callHistoryId: call.id,
      data: {
        status: "MISSED",
        ...terminalData(call, clock),
      },
    });

    const callerSocketId = peers.getLatestSocketId(call.callerId);
    if (callerSocketId) {
      realtime.emitCalleeBusy(callerSocketId);
      realtime.emitCallEndToPeerViaSocket(callerSocketId);
    }
  },

  async relayIceCandidate({
    actorId,
    call,
    targetUserId,
    candidate,
  }) {
    const targetSocketId = peers.getLatestSocketId(targetUserId);
    if (!targetSocketId) return;

    const payload: IceCandidatePayload = {
      callerId: actorId,
      candidate,
      callHistoryId: call.id,
    };
    realtime.emitIceCandidate(targetSocketId, payload);
  },

  async relayNegotiationNeeded({
    actorId,
    call,
    targetUserId,
    offer,
  }) {
    const targetSocketId = peers.getLatestSocketId(targetUserId);

    if (!targetSocketId) {
      await history.update({
        kind: "terminal",
        callHistoryId: call.id,
        data: {
          status: "INTERRUPTED",
          ...terminalData(call, clock),
        },
      });
      realtime.emitCalleeOfflineToActor();
      realtime.emitCallEndToActor();
      return;
    }

    realtime.emitNegotiationNeeded(targetSocketId, {
      offer,
      callerId: actorId,
      callHistoryId: call.id,
    });
  },

  async relayNegotiationDone({
    actorId,
    call,
    targetUserId,
    answer,
  }) {
    const targetSocketId = peers.getLatestSocketId(targetUserId);

    if (!targetSocketId) {
      await history.update({
        kind: "terminal",
        callHistoryId: call.id,
        data: {
          status: "INTERRUPTED",
          ...terminalData(call, clock),
        },
      });
      realtime.emitCallerOfflineToActor();
      realtime.emitCallEndToActor();
      return;
    }

    realtime.emitNegotiationFinal(targetSocketId, {
      answer,
      calleeId: actorId,
      callHistoryId: call.id,
    });
  },
});
