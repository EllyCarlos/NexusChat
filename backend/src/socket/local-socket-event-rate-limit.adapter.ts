import type { RateLimitPolicy } from "../security/rate-limit.js";
import { SocketEventRateLimiter } from "./socket-security.js";
import type { SocketEventRateLimitPort } from "./socket-event-rate-limit.port.js";

export class LocalSocketEventRateLimitAdapter implements SocketEventRateLimitPort {
  constructor(
    private readonly limiter: SocketEventRateLimiter = new SocketEventRateLimiter(),
  ) {}

  async consume(
    policy: RateLimitPolicy,
    keyParts: readonly string[],
  ): Promise<boolean> {
    return this.limiter.consume(policy, keyParts);
  }

  async consumeAll(
    policies: readonly RateLimitPolicy[],
    keyParts: readonly string[],
  ): Promise<boolean> {
    return this.limiter.consumeAll(policies, keyParts);
  }

  clear(): void {
    this.limiter.clear();
  }
}

export const createLocalSocketEventRateLimitProvider = (
  limiter?: SocketEventRateLimiter,
): LocalSocketEventRateLimitAdapter => new LocalSocketEventRateLimitAdapter(limiter);
