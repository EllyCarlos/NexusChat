import type { Server, Socket } from "socket.io";
import { Events } from "../../enums/event/event.enum.js";
import {
  assertActiveCall,
  assertOtherParticipant,
  assertRingingCall,
  assertTerminableCall,
} from "../../modules/calls/application/call-signaling.service.js";
import { createSocketCallSignalingService } from "../../modules/calls/call.service.js";
import {
  callAcceptedEventSchema,
  callStateEventSchema,
  callUserEventSchema,
  iceCandidateEventSchema,
  negoDoneEventSchema,
  negoNeededEventSchema,
} from "../../schemas/socket.schema.js";
import {
  assertCallCallee,
  assertCallParticipant,
  assertCanCallUser,
} from "../../services/authorization.service.js";
import { CustomError } from "../../utils/error.utils.js";
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
  const calls = createSocketCallSignalingService({ io, socket, registry });

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
      await calls.callUser({
        actor: {
          id: socket.user.id,
          username: socket.user.username,
          avatar: socket.user.avatar,
        },
        callee: {
          id: callee.id,
          notificationsEnabled: callee.notificationsEnabled,
          notificationRecipientToken: callee.fcmToken,
        },
        offer,
      });
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
      await calls.acceptCall({
        actorId: socket.user.id,
        call,
        answer,
      });
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
      await calls.rejectCall({ call });
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
      assertTerminableCall(call);

      if (!enforceSocketEventLimits({
        socket,
        event: Events.CALL_END,
        limiter,
        policies: [SOCKET_EVENT_LIMITS.callState],
        keyParts: [userId, call.id],
      })) return;
      await calls.endCall({ call });
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
      await calls.markCalleeBusy({ call });
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
      await calls.relayIceCandidate({
        actorId: socket.user.id,
        call,
        targetUserId,
        candidate,
      });
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
      await calls.relayNegotiationNeeded({
        actorId: socket.user.id,
        call,
        targetUserId,
        offer,
      });
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
      await calls.relayNegotiationDone({
        actorId: socket.user.id,
        call,
        targetUserId,
        answer,
      });
    } catch (error) {
      logServerError("NEGO_DONE event failed.", error);
    }
  });
};

export default registerWebRtcHandlers;
