import type {
  CallAcceptedPayload,
  CallIdPayload,
  IceCandidatePayload,
  IncomingCallPayload,
  NegotiationFinalPayload,
  NegotiationNeededPayload,
} from "./call.types.js";

export interface CallRealtimePort {
  emitCallIdToActor(payload: CallIdPayload): void;
  emitCallEndToActor(): void;
  emitCalleeOfflineToActor(): void;
  emitCallerOfflineToActor(): void;

  emitIncomingCall(
    targetSocketId: string,
    payload: IncomingCallPayload,
  ): void;
  emitCallAccepted(
    targetSocketId: string,
    payload: CallAcceptedPayload,
  ): void;
  emitCallRejected(targetSocketId: string): void;
  emitCallEndToPeerViaSocket(targetSocketId: string): void;
  emitCallEndToPeerViaServer(targetSocketId: string): void;
  emitCalleeBusy(targetSocketId: string): void;
  emitIceCandidate(
    targetSocketId: string,
    payload: IceCandidatePayload,
  ): void;
  emitNegotiationNeeded(
    targetSocketId: string,
    payload: NegotiationNeededPayload,
  ): void;
  emitNegotiationFinal(
    targetSocketId: string,
    payload: NegotiationFinalPayload,
  ): void;
}
