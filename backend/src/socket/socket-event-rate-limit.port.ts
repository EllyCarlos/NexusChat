import {
  hashLimiterKey,
  type RateLimitPolicy,
} from "../security/rate-limit.js";

export interface SocketEventRateLimitPort {
  consume(
    policy: RateLimitPolicy,
    keyParts: readonly string[],
  ): Promise<boolean>;

  consumeAll(
    policies: readonly RateLimitPolicy[],
    keyParts: readonly string[],
  ): Promise<boolean>;
}

export const joinSocketEventRateLimitKeyParts = (
  keyParts: readonly string[],
): string => keyParts.join("\0");

export const createSocketEventRateLimitBucketIdentity = (
  policy: Pick<RateLimitPolicy, "namespace">,
  keyParts: readonly string[],
): string => hashLimiterKey(
  policy.namespace,
  joinSocketEventRateLimitKeyParts(keyParts),
);
