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
import type { LoggerPort } from "../../observability/logger.port.js";
import { noopLogger } from "../../observability/noop-logger.js";
import { logSafeError } from "../../observability/safe-error.js";
import { CustomError } from "../../utils/error.utils.js";
import type { SocketConnectionDirectory } from "../connection-directory.js";
import type { SocketEventRateLimitPort } from "../socket-event-rate-limit.port.js";
import type { SendPushNotificationInput } from "../../modules/notifications/application/send-push-notification.js";
import { sendPushNotification } from "../../modules/notifications/push-notification.service.js";
import {
  enforceSocketEventLimits,
  parseSocketPayload,
  SOCKET_EVENT_LIMITS,
} from "../socket-security.js";

type WebRtcHandlerDependencies = {
  directory: SocketConnectionDirectory;
  limiter: SocketEventRateLimitPort;
  logger?: LoggerPort;
  sendNotification?: (input: SendPushNotificationInput) => void;
};

const registerWebRtcHandlers = (
  socket: Socket,
  io: Server,
  dependencies: WebRtcHandlerDependencies,
) => {
  const {
    directory,
    limiter,
    logger = noopLogger.forComponent("socket"),
    sendNotification = sendPushNotification,
  } = dependencies;
  const userId = socket.user.id;
  const calls = createSocketCallSignalingService({
    io,
    socket,
    directory,
    sendNotification,
  });

  socket.on(Events.CALL_USER, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.CALL_USER, callUserEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { calleeId, offer } = parsedPayload;
    if (!(await enforceSocketEventLimits({
      socket,
      event: Events.CALL_USER,
      limiter,
      logger,
      policies: [SOCKET_EVENT_LIMITS.callActor],
      keyParts: [userId],
    }))) return;
    try {
      const callee = await assertCanCallUser(userId, calleeId);
      if (!(await enforceSocketEventLimits({
        socket,
        event: Events.CALL_USER,
        limiter,
        logger,
        policies: [SOCKET_EVENT_LIMITS.callInitiation],
        keyParts: [userId, callee.id],
      }))) return;
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
      logSafeError(logger, "socket.call_user.failed", error, {
        operation: "call_user",
        result: "failed",
      });
    }
  });

  socket.on(Events.CALL_ACCEPTED, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.CALL_ACCEPTED, callAcceptedEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { answer, callerId, callHistoryId } = parsedPayload;
    if (!(await enforceSocketEventLimits({
      socket,
      event: Events.CALL_ACCEPTED,
      limiter,
      logger,
      policies: [SOCKET_EVENT_LIMITS.callActor],
      keyParts: [userId],
    }))) return;
    try {
      const call = await assertCallCallee(userId, callHistoryId);
      assertRingingCall(call);
      if (callerId !== call.callerId) {
        throw new CustomError("Call participant mismatch", 403);
      }

      if (!(await enforceSocketEventLimits({
        socket,
        event: Events.CALL_ACCEPTED,
        limiter,
        logger,
        policies: [SOCKET_EVENT_LIMITS.callState],
        keyParts: [userId, call.id],
      }))) return;
      await calls.acceptCall({
        actorId: socket.user.id,
        call,
        answer,
      });
    } catch (error) {
      logSafeError(logger, "socket.call_acceptance.failed", error, {
        operation: "call_accept",
        result: "failed",
      });
    }
  });

  socket.on(Events.CALL_REJECTED, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.CALL_REJECTED, callStateEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { callHistoryId } = parsedPayload;
    if (!(await enforceSocketEventLimits({
      socket,
      event: Events.CALL_REJECTED,
      limiter,
      logger,
      policies: [SOCKET_EVENT_LIMITS.callActor],
      keyParts: [userId],
    }))) return;
    try {
      const call = await assertCallCallee(userId, callHistoryId);
      assertRingingCall(call);
      if (!(await enforceSocketEventLimits({
        socket,
        event: Events.CALL_REJECTED,
        limiter,
        logger,
        policies: [SOCKET_EVENT_LIMITS.callState],
        keyParts: [userId, call.id],
      }))) return;
      await calls.rejectCall({ call });
    } catch (error) {
      logSafeError(logger, "socket.call_rejection.failed", error, {
        operation: "call_reject",
        result: "failed",
      });
    }
  });

  socket.on(Events.CALL_END, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.CALL_END, callStateEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { callHistoryId } = parsedPayload;
    if (!(await enforceSocketEventLimits({
      socket,
      event: Events.CALL_END,
      limiter,
      logger,
      policies: [SOCKET_EVENT_LIMITS.callActor],
      keyParts: [userId],
    }))) return;
    try {
      const call = await assertCallParticipant(userId, callHistoryId);
      assertTerminableCall(call);

      if (!(await enforceSocketEventLimits({
        socket,
        event: Events.CALL_END,
        limiter,
        logger,
        policies: [SOCKET_EVENT_LIMITS.callState],
        keyParts: [userId, call.id],
      }))) return;
      await calls.endCall({ call });
    } catch (error) {
      logSafeError(logger, "socket.call_end.failed", error, {
        operation: "call_end",
        result: "failed",
      });
    }
  });

  socket.on(Events.CALLEE_BUSY, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.CALLEE_BUSY, callStateEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { callHistoryId } = parsedPayload;
    if (!(await enforceSocketEventLimits({
      socket,
      event: Events.CALLEE_BUSY,
      limiter,
      logger,
      policies: [SOCKET_EVENT_LIMITS.callActor],
      keyParts: [userId],
    }))) return;
    try {
      const call = await assertCallCallee(userId, callHistoryId);
      assertRingingCall(call);
      if (!(await enforceSocketEventLimits({
        socket,
        event: Events.CALLEE_BUSY,
        limiter,
        logger,
        policies: [SOCKET_EVENT_LIMITS.callState],
        keyParts: [userId, call.id],
      }))) return;
      await calls.markCalleeBusy({ call });
    } catch (error) {
      logSafeError(logger, "socket.callee_busy.failed", error, {
        operation: "callee_busy",
        result: "failed",
      });
    }
  });

  socket.on(Events.ICE_CANDIDATE, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.ICE_CANDIDATE, iceCandidateEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { candidate, calleeId, callHistoryId } = parsedPayload;
    if (!(await enforceSocketEventLimits({
      socket,
      event: Events.ICE_CANDIDATE,
      limiter,
      logger,
      policies: [SOCKET_EVENT_LIMITS.iceActor],
      keyParts: [userId],
    }))) return;
    try {
      const call = await assertCallParticipant(userId, callHistoryId);
      assertActiveCall(call);
      const targetUserId = assertOtherParticipant(call, userId, calleeId);
      if (!(await enforceSocketEventLimits({
        socket,
        event: Events.ICE_CANDIDATE,
        limiter,
        logger,
        policies: [SOCKET_EVENT_LIMITS.iceCall],
        keyParts: [userId, call.id],
      }))) return;
      await calls.relayIceCandidate({
        actorId: socket.user.id,
        call,
        targetUserId,
        candidate,
      });
    } catch (error) {
      logSafeError(logger, "socket.ice_candidate.failed", error, {
        operation: "ice_candidate",
        result: "failed",
      });
    }
  });

  socket.on(Events.NEGO_NEEDED, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.NEGO_NEEDED, negoNeededEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { offer, calleeId, callHistoryId } = parsedPayload;
    if (!(await enforceSocketEventLimits({
      socket,
      event: Events.NEGO_NEEDED,
      limiter,
      logger,
      policies: [SOCKET_EVENT_LIMITS.negotiationActor],
      keyParts: [userId],
    }))) return;
    try {
      const call = await assertCallParticipant(userId, callHistoryId);
      assertActiveCall(call);
      const targetUserId = assertOtherParticipant(call, userId, calleeId);
      if (!(await enforceSocketEventLimits({
        socket,
        event: Events.NEGO_NEEDED,
        limiter,
        logger,
        policies: [SOCKET_EVENT_LIMITS.negotiationCall],
        keyParts: [userId, call.id],
      }))) return;
      await calls.relayNegotiationNeeded({
        actorId: socket.user.id,
        call,
        targetUserId,
        offer,
      });
    } catch (error) {
      logSafeError(logger, "socket.negotiation_needed.failed", error, {
        operation: "negotiation_needed",
        result: "failed",
      });
    }
  });

  socket.on(Events.NEGO_DONE, async (rawPayload: unknown) => {
    const parsedPayload = parseSocketPayload(socket, Events.NEGO_DONE, negoDoneEventSchema, rawPayload);
    if (!parsedPayload) return;
    const { answer, callerId, callHistoryId } = parsedPayload;
    if (!(await enforceSocketEventLimits({
      socket,
      event: Events.NEGO_DONE,
      limiter,
      logger,
      policies: [SOCKET_EVENT_LIMITS.negotiationActor],
      keyParts: [userId],
    }))) return;
    try {
      const call = await assertCallParticipant(userId, callHistoryId);
      assertActiveCall(call);
      const targetUserId = assertOtherParticipant(call, userId, callerId);
      if (!(await enforceSocketEventLimits({
        socket,
        event: Events.NEGO_DONE,
        limiter,
        logger,
        policies: [SOCKET_EVENT_LIMITS.negotiationCall],
        keyParts: [userId, call.id],
      }))) return;
      await calls.relayNegotiationDone({
        actorId: socket.user.id,
        call,
        targetUserId,
        answer,
      });
    } catch (error) {
      logSafeError(logger, "socket.negotiation_done.failed", error, {
        operation: "negotiation_done",
        result: "failed",
      });
    }
  });
};

export default registerWebRtcHandlers;
