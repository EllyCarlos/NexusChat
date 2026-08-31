import type { Socket } from "socket.io";
import type { z } from "zod";
import { Events } from "../enums/event/event.enum.js";
import {
  BoundedInMemoryRateLimiter,
  type RateLimitPolicy,
} from "../security/rate-limit.js";
import { logServerError } from "../utils/safe-logger.utils.js";
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
}: {
  socket: Socket;
  event: string;
  limiter: SocketEventRateLimitPort;
  policies: readonly RateLimitPolicy[];
  keyParts: readonly string[];
}): Promise<boolean> => {
  try {
    if (await limiter.consumeAll(policies, keyParts)) return true;
  } catch (error) {
    logServerError("Socket rate-limit evaluation failed.", error);
  }

  emitSocketSecurityError(socket, "RATE_LIMITED", event);
  return false;
};
