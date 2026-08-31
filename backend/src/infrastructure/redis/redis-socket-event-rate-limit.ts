import type { RateLimitPolicy } from "../../security/rate-limit.js";
import {
  createSocketEventRateLimitBucketIdentity,
  type SocketEventRateLimitPort,
} from "../../socket/socket-event-rate-limit.port.js";
import type { RedisScriptExecutor } from "./redis-script-executor.js";
import {
  CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT,
  SOCKET_EVENT_RATE_LIMIT_REDIS_KEY_PREFIX,
} from "./socket-event-rate-limit-script.js";

type ReadyRedisScriptExecutor = RedisScriptExecutor & {
  readonly isReady: boolean;
};

type RedisSocketEventRateLimitOptions = {
  executor: ReadyRedisScriptExecutor;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validatePolicy = (policy: RateLimitPolicy): void => {
  if (policy.namespace.length === 0 || policy.namespace.includes("\0")) {
    throw new Error("Invalid Socket event rate-limit namespace.");
  }

  if (!Number.isSafeInteger(policy.limit) || policy.limit <= 0) {
    throw new Error("Invalid Socket event rate-limit limit.");
  }

  if (!Number.isSafeInteger(policy.windowMs) || policy.windowMs <= 0) {
    throw new Error("Invalid Socket event rate-limit window.");
  }
};

const parseDecision = (value: unknown): boolean => {
  if (typeof value !== "string") {
    throw new Error("Invalid Redis Socket event rate-limit response.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Invalid Redis Socket event rate-limit response.");
  }

  if (!isRecord(parsed)
    || Object.keys(parsed).length !== 1
    || typeof parsed.allowed !== "boolean") {
    throw new Error("Invalid Redis Socket event rate-limit response.");
  }

  return parsed.allowed;
};

export class RedisSocketEventRateLimitProvider implements SocketEventRateLimitPort {
  private readonly executor: ReadyRedisScriptExecutor;

  constructor({ executor }: RedisSocketEventRateLimitOptions) {
    this.executor = executor;
  }

  async consume(
    policy: RateLimitPolicy,
    keyParts: readonly string[],
  ): Promise<boolean> {
    validatePolicy(policy);
    if (!this.executor.isReady) {
      throw new Error("Redis Socket event rate-limit executor is not ready.");
    }

    const bucketIdentity = createSocketEventRateLimitBucketIdentity(
      policy,
      keyParts,
    );
    return parseDecision(await this.executor.eval(
      CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT,
      {
        keys: [`${SOCKET_EVENT_RATE_LIMIT_REDIS_KEY_PREFIX}${bucketIdentity}`],
        arguments: [String(policy.limit), String(policy.windowMs)],
      },
    ));
  }

  async consumeAll(
    policies: readonly RateLimitPolicy[],
    keyParts: readonly string[],
  ): Promise<boolean> {
    for (const policy of policies) {
      if (!await this.consume(policy, keyParts)) return false;
    }

    return true;
  }
}

export const createRedisSocketEventRateLimitProvider = (
  options: RedisSocketEventRateLimitOptions,
): RedisSocketEventRateLimitProvider =>
  new RedisSocketEventRateLimitProvider(options);
