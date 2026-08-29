export type CallStatus =
  | "MISSED"
  | "COMPLETED"
  | "REJECTED"
  | "INTERRUPTED"
  | "RINGING";

export interface CallRecord {
  id: string;
  callerId: string;
  calleeId: string;
  startedAt: Date;
  endedAt: Date | null;
  status: CallStatus;
}

export interface CallActor {
  id: string;
  username: string;
  avatar: string;
}

export interface CallablePeer {
  id: string;
  notificationsEnabled: boolean;
  notificationRecipientToken: string | null;
}

export interface CallSessionDescription {
  type: "offer" | "answer";
  sdp: string;
}

export type CallOffer = CallSessionDescription;
export type CallAnswer = CallSessionDescription;

export interface SerializedIceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface CallIdPayload {
  callHistoryId: string;
}

export interface IncomingCallPayload {
  caller: CallActor;
  offer: CallOffer;
  callHistoryId: string;
}

export interface CallAcceptedPayload {
  calleeId: string;
  answer: CallAnswer;
  callHistoryId: string;
}

export interface IceCandidatePayload {
  candidate: SerializedIceCandidate;
  callerId: string;
  callHistoryId: string;
}

export interface NegotiationNeededPayload {
  offer: CallOffer;
  callerId: string;
  callHistoryId: string;
}

export interface NegotiationFinalPayload {
  answer: CallAnswer;
  calleeId: string;
  callHistoryId: string;
}
