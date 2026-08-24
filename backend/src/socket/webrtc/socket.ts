import { Server, Socket } from "socket.io";
import { Events } from "../../enums/event/event.enum.js";
import { prisma } from "../../lib/prisma.lib.js";
import {
  callAcceptedEventSchema,
  callStateEventSchema,
  callUserEventSchema,
  iceCandidateEventSchema,
  negoDoneEventSchema,
  negoNeededEventSchema,
} from "../../schemas/socket.schema.js";
import type { AuthorizedCall } from "../../services/authorization.service.js";
import {
  assertCallCallee,
  assertCallParticipant,
  assertCanCallUser,
} from "../../services/authorization.service.js";
import { CustomError } from "../../utils/error.utils.js";
import { sendPushNotification } from "../../utils/generic.js";
import { logServerError } from "../../utils/safe-logger.utils.js";
import {
  socketConnectionRegistry,
  type SocketConnectionRegistry,
} from "../connection-registry.js";
import {
  enforceSocketEventLimits,
  parseSocketPayload,
  SOCKET_EVENT_LIMITS,
  socketEventRateLimiter,
  type SocketEventRateLimiter,
} from "../socket-security.js";

type IncomingCallEventSendPayload = {
  caller: { id: string; username: string; avatar: string };
  offer: RTCSessionDescriptionInit;
  callHistoryId: string;
};

type CallAcceptedEventSendPayload = {
  calleeId: string;
  answer: RTCSessionDescriptionInit;
  callHistoryId: string;
};

type NegoNeededEventSendPayload = {
  offer: RTCSessionDescriptionInit;
  callerId: string;
  callHistoryId: string;
};

type NegoFinalEventSendPayload = {
  answer: RTCSessionDescriptionInit;
  calleeId: string;
  callHistoryId: string;
};

type SerializedIceCandidate = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

type IceCandidateEventSendPayload = {
  candidate: SerializedIceCandidate;
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

type WebRtcHandlerDependencies = {
  registry?: SocketConnectionRegistry;
  limiter?: SocketEventRateLimiter;
};

const registerWebRtcHandlers = (
  socket: Socket,
  io: Server,
  dependencies: WebRtcHandlerDependencies = {},
) => {
  const registry = dependencies.registry ?? socketConnectionRegistry;
  const limiter = dependencies.limiter ?? socketEventRateLimiter;
  const userId = socket.user.id;

  socket.on(Events.CALL_USER, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.CALL_USER, callUserEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { calleeId, offer } = parsedPayload;
    if (!enforceSocketEventLimits({
      socket,
      event: Events.CALL_USER,
      limiter,
      policies: [SOCKET_EVENT_LIMITS.callActor],
      keyParts: [userId],
    })) return;
    try {
      const callee = await assertCanCallUser(userId, calleeId);
      if (!enforceSocketEventLimits({
        socket,
        event: Events.CALL_USER,
        limiter,
        policies: [SOCKET_EVENT_LIMITS.callInitiation],
        keyParts: [userId, callee.id],
      })) return;
      const calleeSocketId = registry.getLatestSocket(callee.id);

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
      logServerError("CALL_USER event failed.", error);
    }
  });

  socket.on(Events.CALL_ACCEPTED, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.CALL_ACCEPTED, callAcceptedEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { answer, callerId, callHistoryId } = parsedPayload;
    if (!enforceSocketEventLimits({
      socket,
      event: Events.CALL_ACCEPTED,
      limiter,
      policies: [SOCKET_EVENT_LIMITS.callActor],
      keyParts: [userId],
    })) return;
    try {
      const call = await assertCallCallee(userId, callHistoryId);
      assertRingingCall(call);
      if (callerId !== call.callerId) {
        throw new CustomError("Call participant mismatch", 403);
      }

      if (!enforceSocketEventLimits({
        socket,
        event: Events.CALL_ACCEPTED,
        limiter,
        policies: [SOCKET_EVENT_LIMITS.callState],
        keyParts: [userId, call.id],
      })) return;

      const callerSocketId = registry.getLatestSocket(call.callerId);
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
      logServerError("CALL_ACCEPTED event failed.", error);
    }
  });

  socket.on(Events.CALL_REJECTED, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.CALL_REJECTED, callStateEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { callHistoryId } = parsedPayload;
    if (!enforceSocketEventLimits({
      socket,
      event: Events.CALL_REJECTED,
      limiter,
      policies: [SOCKET_EVENT_LIMITS.callActor],
      keyParts: [userId],
    })) return;
    try {
      const call = await assertCallCallee(userId, callHistoryId);
      assertRingingCall(call);
      if (!enforceSocketEventLimits({
        socket,
        event: Events.CALL_REJECTED,
        limiter,
        policies: [SOCKET_EVENT_LIMITS.callState],
        keyParts: [userId, call.id],
      })) return;
      await prisma.callHistory.update({
        where: { id: call.id },
        data: { status: "REJECTED", ...callEndData(call) },
      });

      const callerSocketId = registry.getLatestSocket(call.callerId);
      if (callerSocketId) {
        socket.to(callerSocketId).emit(Events.CALL_REJECTED);
        socket.to(callerSocketId).emit(Events.CALL_END);
      }
      socket.emit(Events.CALL_END);
    } catch (error) {
      logServerError("CALL_REJECTED event failed.", error);
    }
  });

  socket.on(Events.CALL_END, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.CALL_END, callStateEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { callHistoryId } = parsedPayload;
    if (!enforceSocketEventLimits({
      socket,
      event: Events.CALL_END,
      limiter,
      policies: [SOCKET_EVENT_LIMITS.callActor],
      keyParts: [userId],
    })) return;
    try {
      const call = await assertCallParticipant(userId, callHistoryId);
      if (call.endedAt || !["RINGING", "COMPLETED"].includes(call.status)) {
        throw new CustomError("Call is already terminal", 409);
      }

      if (!enforceSocketEventLimits({
        socket,
        event: Events.CALL_END,
        limiter,
        policies: [SOCKET_EVENT_LIMITS.callState],
        keyParts: [userId, call.id],
      })) return;

      const finalStatus = call.status === "RINGING" ? "MISSED" : "COMPLETED";
      await prisma.callHistory.update({
        where: { id: call.id },
        data: { status: finalStatus, ...callEndData(call) },
      });

      const callerSocketId = registry.getLatestSocket(call.callerId);
      const calleeSocketId = registry.getLatestSocket(call.calleeId);
      if (callerSocketId) io.to(callerSocketId).emit(Events.CALL_END);
      if (calleeSocketId) io.to(calleeSocketId).emit(Events.CALL_END);
    } catch (error) {
      logServerError("CALL_END event failed.", error);
    }
  });

  socket.on(Events.CALLEE_BUSY, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.CALLEE_BUSY, callStateEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { callHistoryId } = parsedPayload;
    if (!enforceSocketEventLimits({
      socket,
      event: Events.CALLEE_BUSY,
      limiter,
      policies: [SOCKET_EVENT_LIMITS.callActor],
      keyParts: [userId],
    })) return;
    try {
      const call = await assertCallCallee(userId, callHistoryId);
      assertRingingCall(call);
      if (!enforceSocketEventLimits({
        socket,
        event: Events.CALLEE_BUSY,
        limiter,
        policies: [SOCKET_EVENT_LIMITS.callState],
        keyParts: [userId, call.id],
      })) return;
      await prisma.callHistory.update({
        where: { id: call.id },
        data: { status: "MISSED", ...callEndData(call) },
      });

      const callerSocketId = registry.getLatestSocket(call.callerId);
      if (callerSocketId) {
        socket.to(callerSocketId).emit(Events.CALLEE_BUSY);
        socket.to(callerSocketId).emit(Events.CALL_END);
      }
    } catch (error) {
      logServerError("CALLEE_BUSY event failed.", error);
    }
  });

  socket.on(Events.ICE_CANDIDATE, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.ICE_CANDIDATE, iceCandidateEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { candidate, calleeId, callHistoryId } = parsedPayload;
    if (!enforceSocketEventLimits({
      socket,
      event: Events.ICE_CANDIDATE,
      limiter,
      policies: [SOCKET_EVENT_LIMITS.iceActor],
      keyParts: [userId],
    })) return;
    try {
      const call = await assertCallParticipant(userId, callHistoryId);
      assertActiveCall(call);
      const targetUserId = assertOtherParticipant(call, userId, calleeId);
      if (!enforceSocketEventLimits({
        socket,
        event: Events.ICE_CANDIDATE,
        limiter,
        policies: [SOCKET_EVENT_LIMITS.iceCall],
        keyParts: [userId, call.id],
      })) return;
      const targetSocketId = registry.getLatestSocket(targetUserId);
      if (!targetSocketId) return;

      const payload: IceCandidateEventSendPayload = {
        callerId: socket.user.id,
        candidate,
        callHistoryId: call.id,
      };
      io.to(targetSocketId).emit(Events.ICE_CANDIDATE, payload);
    } catch (error) {
      logServerError("ICE_CANDIDATE event failed.", error);
    }
  });

  socket.on(Events.NEGO_NEEDED, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.NEGO_NEEDED, negoNeededEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { offer, calleeId, callHistoryId } = parsedPayload;
    if (!enforceSocketEventLimits({
      socket,
      event: Events.NEGO_NEEDED,
      limiter,
      policies: [SOCKET_EVENT_LIMITS.negotiationActor],
      keyParts: [userId],
    })) return;
    try {
      const call = await assertCallParticipant(userId, callHistoryId);
      assertActiveCall(call);
      const targetUserId = assertOtherParticipant(call, userId, calleeId);
      if (!enforceSocketEventLimits({
        socket,
        event: Events.NEGO_NEEDED,
        limiter,
        policies: [SOCKET_EVENT_LIMITS.negotiationCall],
        keyParts: [userId, call.id],
      })) return;
      const targetSocketId = registry.getLatestSocket(targetUserId);

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
      logServerError("NEGO_NEEDED event failed.", error);
    }
  });

  socket.on(Events.NEGO_DONE, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.NEGO_DONE, negoDoneEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { answer, callerId, callHistoryId } = parsedPayload;
    if (!enforceSocketEventLimits({
      socket,
      event: Events.NEGO_DONE,
      limiter,
      policies: [SOCKET_EVENT_LIMITS.negotiationActor],
      keyParts: [userId],
    })) return;
    try {
      const call = await assertCallParticipant(userId, callHistoryId);
      assertActiveCall(call);
      const targetUserId = assertOtherParticipant(call, userId, callerId);
      if (!enforceSocketEventLimits({
        socket,
        event: Events.NEGO_DONE,
        limiter,
        policies: [SOCKET_EVENT_LIMITS.negotiationCall],
        keyParts: [userId, call.id],
      })) return;
      const targetSocketId = registry.getLatestSocket(targetUserId);

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
      logServerError("NEGO_DONE event failed.", error);
    }
  });
};

export default registerWebRtcHandlers;
