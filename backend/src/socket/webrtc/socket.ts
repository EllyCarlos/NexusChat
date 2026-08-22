import { Server, Socket } from "socket.io";
import { Events } from "../../enums/event/event.enum.js";
import { userSocketIds } from "../../index.js";
import { prisma } from "../../lib/prisma.lib.js";
import type { AuthorizedCall } from "../../services/authorization.service.js";
import {
  assertCallCallee,
  assertCallParticipant,
  assertCanCallUser,
} from "../../services/authorization.service.js";
import { CustomError } from "../../utils/error.utils.js";
import { sendPushNotification } from "../../utils/generic.js";

type CallUserEventReceivePayload = {
  calleeId: string;
  offer: RTCSessionDescriptionInit;
};

type IncomingCallEventSendPayload = {
  caller: { id: string; username: string; avatar: string };
  offer: RTCSessionDescriptionInit;
  callHistoryId: string;
};

type CallAcceptedEventReceivePayload = {
  callerId: string;
  answer: RTCSessionDescriptionInit;
  callHistoryId: string;
};

type CallAcceptedEventSendPayload = {
  calleeId: string;
  answer: RTCSessionDescriptionInit;
  callHistoryId: string;
};

type NegoNeededEventReceivePayload = {
  calleeId: string;
  offer: RTCSessionDescriptionInit;
  callHistoryId: string;
};

type NegoNeededEventSendPayload = {
  offer: RTCSessionDescriptionInit;
  callerId: string;
  callHistoryId: string;
};

type NegoDoneEventReceivePayload = {
  answer: RTCSessionDescriptionInit;
  callerId: string;
  callHistoryId: string;
};

type NegoFinalEventSendPayload = {
  answer: RTCSessionDescriptionInit;
  calleeId: string;
  callHistoryId: string;
};

type CallEndEventReceivePayload = { callHistoryId: string };
type CallRejectedEventReceivePayload = { callHistoryId: string };
type CalleeBusyEventReceivePayload = { callHistoryId: string };

type IceCandidateEventReceivePayload = {
  candidate: RTCIceCandidate;
  calleeId: string;
  callHistoryId: string;
};

type IceCandidateEventSendPayload = {
  candidate: RTCIceCandidate;
  callerId: string;
  callHistoryId: string;
};

type CallIdEventSendPayload = { callHistoryId: string };

const callEndData = (call: AuthorizedCall) => {
  const endedAt = new Date();
  return {
    endedAt,
    duration: Math.floor((endedAt.getTime() - call.startedAt.getTime()) / 1000),
  };
};

const assertRingingCall = (call: AuthorizedCall): void => {
  if (call.status !== "RINGING" || call.endedAt) {
    throw new CustomError("Call is not awaiting an answer", 409);
  }
};

const assertActiveCall = (call: AuthorizedCall): void => {
  // The schema has no ACCEPTED state. COMPLETED + endedAt=null represents an
  // accepted active call; endedAt marks its terminal transition.
  if (call.status !== "COMPLETED" || call.endedAt) {
    throw new CustomError("Call is not active", 409);
  }
};

const assertOtherParticipant = (
  call: AuthorizedCall,
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

const registerWebRtcHandlers = (socket: Socket, io: Server) => {
  socket.on(Events.CALL_USER, async ({ calleeId, offer }: CallUserEventReceivePayload) => {
    try {
      const callee = await assertCanCallUser(socket.user.id, calleeId);
      const calleeSocketId = userSocketIds.get(callee.id);

      if (!calleeSocketId) {
        socket.emit(Events.CALLEE_OFFLINE);
        socket.emit(Events.CALL_END);
        await prisma.callHistory.create({
          data: {
            callerId: socket.user.id,
            calleeId: callee.id,
            status: "MISSED",
            endedAt: new Date(),
            duration: 0,
          },
        });

        if (callee.notificationsEnabled && callee.fcmToken) {
          sendPushNotification({
            fcmToken: callee.fcmToken,
            body: `You have missed a call from ${socket.user.username}`,
            title: "Missed Call",
          });
        }
        return;
      }

      const newCall = await prisma.callHistory.create({
        data: { callerId: socket.user.id, calleeId: callee.id },
      });
      const incomingCallPayload: IncomingCallEventSendPayload = {
        caller: {
          id: socket.user.id,
          username: socket.user.username,
          avatar: socket.user.avatar,
        },
        offer,
        callHistoryId: newCall.id,
      };
      const callIdPayload: CallIdEventSendPayload = { callHistoryId: newCall.id };

      socket.emit(Events.CALL_ID, callIdPayload);
      io.to(calleeSocketId).emit(Events.INCOMING_CALL, incomingCallPayload);
    } catch (error) {
      console.log("Error in CALL_USER event", error);
    }
  });

  socket.on(Events.CALL_ACCEPTED, async ({ answer, callerId, callHistoryId }: CallAcceptedEventReceivePayload) => {
    try {
      const call = await assertCallCallee(socket.user.id, callHistoryId);
      assertRingingCall(call);
      if (callerId !== call.callerId) {
        throw new CustomError("Call participant mismatch", 403);
      }

      const callerSocketId = userSocketIds.get(call.callerId);
      if (!callerSocketId) {
        await prisma.callHistory.update({
          where: { id: call.id },
          data: { status: "MISSED", ...callEndData(call) },
        });
        socket.emit(Events.CALL_END);
        socket.emit(Events.CALLER_OFFLINE);
        return;
      }

      await prisma.callHistory.update({
        where: { id: call.id },
        data: { status: "COMPLETED" },
      });
      const payload: CallAcceptedEventSendPayload = {
        calleeId: socket.user.id,
        answer,
        callHistoryId: call.id,
      };
      socket.to(callerSocketId).emit(Events.CALL_ACCEPTED, payload);
    } catch (error) {
      console.log("Error in CALL_ACCEPTED event", error);
    }
  });

  socket.on(Events.CALL_REJECTED, async ({ callHistoryId }: CallRejectedEventReceivePayload) => {
    try {
      const call = await assertCallCallee(socket.user.id, callHistoryId);
      assertRingingCall(call);
      await prisma.callHistory.update({
        where: { id: call.id },
        data: { status: "REJECTED", ...callEndData(call) },
      });

      const callerSocketId = userSocketIds.get(call.callerId);
      if (callerSocketId) {
        socket.to(callerSocketId).emit(Events.CALL_REJECTED);
        socket.to(callerSocketId).emit(Events.CALL_END);
      }
      socket.emit(Events.CALL_END);
    } catch (error) {
      console.log("Error in CALL_REJECTED event", error);
    }
  });

  socket.on(Events.CALL_END, async ({ callHistoryId }: CallEndEventReceivePayload) => {
    try {
      const call = await assertCallParticipant(socket.user.id, callHistoryId);
      if (call.endedAt || !["RINGING", "COMPLETED"].includes(call.status)) {
        throw new CustomError("Call is already terminal", 409);
      }

      const finalStatus = call.status === "RINGING" ? "MISSED" : "COMPLETED";
      await prisma.callHistory.update({
        where: { id: call.id },
        data: { status: finalStatus, ...callEndData(call) },
      });

      const callerSocketId = userSocketIds.get(call.callerId);
      const calleeSocketId = userSocketIds.get(call.calleeId);
      if (callerSocketId) io.to(callerSocketId).emit(Events.CALL_END);
      if (calleeSocketId) io.to(calleeSocketId).emit(Events.CALL_END);
    } catch (error) {
      console.log("Error in CALL_END event", error);
    }
  });

  socket.on(Events.CALLEE_BUSY, async ({ callHistoryId }: CalleeBusyEventReceivePayload) => {
    try {
      const call = await assertCallCallee(socket.user.id, callHistoryId);
      assertRingingCall(call);
      await prisma.callHistory.update({
        where: { id: call.id },
        data: { status: "MISSED", ...callEndData(call) },
      });

      const callerSocketId = userSocketIds.get(call.callerId);
      if (callerSocketId) {
        socket.to(callerSocketId).emit(Events.CALLEE_BUSY);
        socket.to(callerSocketId).emit(Events.CALL_END);
      }
    } catch (error) {
      console.log("Error in CALLEE_BUSY event", error);
    }
  });

  socket.on(Events.ICE_CANDIDATE, async ({ candidate, calleeId, callHistoryId }: IceCandidateEventReceivePayload) => {
    try {
      const call = await assertCallParticipant(socket.user.id, callHistoryId);
      assertActiveCall(call);
      const targetUserId = assertOtherParticipant(call, socket.user.id, calleeId);
      const targetSocketId = userSocketIds.get(targetUserId);
      if (!targetSocketId) return;

      const payload: IceCandidateEventSendPayload = {
        callerId: socket.user.id,
        candidate,
        callHistoryId: call.id,
      };
      io.to(targetSocketId).emit(Events.ICE_CANDIDATE, payload);
    } catch (error) {
      console.log("Error in ICE_CANDIDATE event", error);
    }
  });

  socket.on(Events.NEGO_NEEDED, async ({ offer, calleeId, callHistoryId }: NegoNeededEventReceivePayload) => {
    try {
      const call = await assertCallParticipant(socket.user.id, callHistoryId);
      assertActiveCall(call);
      const targetUserId = assertOtherParticipant(call, socket.user.id, calleeId);
      const targetSocketId = userSocketIds.get(targetUserId);

      if (!targetSocketId) {
        await prisma.callHistory.update({
          where: { id: call.id },
          data: { status: "INTERRUPTED", ...callEndData(call) },
        });
        socket.emit(Events.CALLEE_OFFLINE);
        socket.emit(Events.CALL_END);
        return;
      }

      const payload: NegoNeededEventSendPayload = {
        offer,
        callerId: socket.user.id,
        callHistoryId: call.id,
      };
      socket.to(targetSocketId).emit(Events.NEGO_NEEDED, payload);
    } catch (error) {
      console.log("Error in NEGO_NEEDED event", error);
    }
  });

  socket.on(Events.NEGO_DONE, async ({ answer, callerId, callHistoryId }: NegoDoneEventReceivePayload) => {
    try {
      const call = await assertCallParticipant(socket.user.id, callHistoryId);
      assertActiveCall(call);
      const targetUserId = assertOtherParticipant(call, socket.user.id, callerId);
      const targetSocketId = userSocketIds.get(targetUserId);

      if (!targetSocketId) {
        await prisma.callHistory.update({
          where: { id: call.id },
          data: { status: "INTERRUPTED", ...callEndData(call) },
        });
        socket.emit(Events.CALLER_OFFLINE);
        socket.emit(Events.CALL_END);
        return;
      }

      const payload: NegoFinalEventSendPayload = {
        answer,
        calleeId: socket.user.id,
        callHistoryId: call.id,
      };
      socket.to(targetSocketId).emit(Events.NEGO_FINAL, payload);
    } catch (error) {
      console.log("Error in NEGO_DONE event", error);
    }
  });
};

export default registerWebRtcHandlers;
