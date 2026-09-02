import type { Socket } from "socket.io";
import type { z } from "zod";
import { Events } from "../enums/event/event.enum.js";
import type { LoggerPort } from "../observability/logger.port.js";
import type {
  MetricsPort,
  SocketMetricOperation,
} from "../observability/metrics.port.js";
import { noopLogger } from "../observability/noop-logger.js";
import { noopMetrics } from "../observability/noop-metrics.js";
import { emitOperationError } from "../observability/operation-observer.js";
import { recordSocketRateLimitRejection } from "../observability/realtime-metrics.js";
import {
  BoundedInMemoryRateLimiter,
  type RateLimitPolicy,
} from "../security/rate-limit.js";
import type { SocketEventRateLimitPort } from "./socket-event-rate-limit.port.js";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

export const SOCKET_EVENT_LIMITS = {
  messageActorBurst: { namespace: "socket-message-actor-burst", limit: 30, windowMs: 10 * SECOND },
  messageChatBurst: { namespace: "socket-message-chat-burst", limit: 8, windowMs: 5 * SECOND },
  messageChatWindow: { namespace: "socket-message-chat-window", limit: 60, windowMs: MINUTE },
  typingActor: { namespace: "socket-typing-actor", limit: 40, windowMs: 10 * SECOND },
  typingChat: { namespace: "socket-typing-chat", limit: 5, windowMs: 2 * SECOND },
  seenActor: { namespace: "socket-seen-actor", limit: 60, windowMs: 10 * SECOND },
  seenChat: { namespace: "socket-seen-chat", limit: 20, windowMs: 10 * SECOND },
  mutationActor: { namespace: "socket-mutation-actor", limit: 60, windowMs: MINUTE },
  editMessage: { namespace: "socket-edit-message", limit: 10, windowMs: MINUTE },
  deleteMessage: { namespace: "socket-delete-message", limit: 5, windowMs: MINUTE },
  reactionMessage: { namespace: "socket-reaction-message", limit: 6, windowMs: 10 * SECOND },
  voteMessage: { namespace: "socket-vote-message", limit: 6, windowMs: 10 * SECOND },
  pinMessage: { namespace: "socket-pin-message", limit: 4, windowMs: 30 * SECOND },
  callActor: { namespace: "socket-call-actor", limit: 20, windowMs: MINUTE },
  callInitiation: { namespace: "socket-call-initiation", limit: 3, windowMs: MINUTE },
  callState: { namespace: "socket-call-state", limit: 8, windowMs: MINUTE },
  iceActor: { namespace: "socket-ice-actor", limit: 300, windowMs: 10 * SECOND },
  iceCall: { namespace: "socket-ice-call", limit: 120, windowMs: 10 * SECOND },
  negotiationActor: { namespace: "socket-negotiation-actor", limit: 60, windowMs: 30 * SECOND },
  negotiationCall: { namespace: "socket-negotiation-call", limit: 10, windowMs: 30 * SECOND },
} satisfies Record<string, RateLimitPolicy>;

export const SOCKET_OPERATION_BY_EVENT: Readonly<Partial<Record<Events, SocketMetricOperation>>> = Object.freeze({
  [Events.MESSAGE]: "message_send",
  [Events.MESSAGE_SEEN]: "message_seen",
  [Events.MESSAGE_EDIT]: "message_edit",
  [Events.MESSAGE_DELETE]: "message_delete",
  [Events.USER_TYPING]: "typing",
  [Events.NEW_REACTION]: "reaction_add",
  [Events.DELETE_REACTION]: "reaction_delete",
  [Events.VOTE_IN]: "poll_vote",
  [Events.VOTE_OUT]: "poll_vote_remove",
  [Events.PIN_MESSAGE]: "message_pin",
  [Events.UNPIN_MESSAGE]: "message_unpin",
  [Events.CALL_USER]: "call_user",
  [Events.CALL_ACCEPTED]: "call_accept",
  [Events.CALL_REJECTED]: "call_reject",
  [Events.CALL_END]: "call_end",
  [Events.CALLEE_BUSY]: "callee_busy",
  [Events.ICE_CANDIDATE]: "ice_candidate",
  [Events.NEGO_NEEDED]: "negotiation_needed",
  [Events.NEGO_DONE]: "negotiation_done",
});

export type SocketSecurityErrorCategory =
  | "INVALID_PAYLOAD"
  | "RATE_LIMITED"
  | "CONNECTION_LIMIT";

export type SocketSecurityErrorPayload = {
  category: SocketSecurityErrorCategory;
  event: string;
};

export class SocketEventRateLimiter {
  private readonly limiter: BoundedInMemoryRateLimiter;

  constructor(maxEntries = 10_000, now: () => number = () => Date.now()) {
    this.limiter = new BoundedInMemoryRateLimiter(maxEntries, now);
  }

  consume(policy: RateLimitPolicy, keyParts: readonly string[]): boolean {
    return this.limiter.consume(policy, keyParts.join("\0")).allowed;
  }

  consumeAll(policies: readonly RateLimitPolicy[], keyParts: readonly string[]): boolean {
    return policies.every(policy => this.consume(policy, keyParts));
  }

  clear(): void {
    this.limiter.clear();
  }
}

// Process-local only: multiple application instances do not share these event buckets.
export const socketEventRateLimiter = new SocketEventRateLimiter();

export const emitSocketSecurityError = (
  socket: Socket,
  category: SocketSecurityErrorCategory,
  event: string,
): void => {
  socket.emit(Events.SECURITY_ERROR, { category, event } satisfies SocketSecurityErrorPayload);
};

export const parseSocketPayload = <Schema extends z.ZodTypeAny>(
  socket: Socket,
  event: string,
  schema: Schema,
  payload: unknown,
): z.infer<Schema> | undefined => {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;

  emitSocketSecurityError(socket, "INVALID_PAYLOAD", event);
  return undefined;
};

export const enforceSocketEventLimits = async ({
  socket,
  event,
  limiter,
  policies,
  keyParts,
  logger = noopLogger.forComponent("socket"),
  metrics = noopMetrics,
}: {
  socket: Socket;
  event: string;
  limiter: SocketEventRateLimitPort;
  policies: readonly RateLimitPolicy[];
  keyParts: readonly string[];
  logger?: LoggerPort;
  metrics?: MetricsPort;
}): Promise<boolean> => {
  try {
    if (await limiter.consumeAll(policies, keyParts)) return true;
    const operation = SOCKET_OPERATION_BY_EVENT[event as Events];
    if (operation) recordSocketRateLimitRejection(metrics, operation);
  } catch (error) {
    emitOperationError(logger, "socket.rate_limit.unavailable", error, {
      operation: SOCKET_OPERATION_BY_EVENT[event as Events] ?? "rate_limit_check",
      result: "unavailable",
    });
  }

  emitSocketSecurityError(socket, "RATE_LIMITED", event);
  return false;
};
