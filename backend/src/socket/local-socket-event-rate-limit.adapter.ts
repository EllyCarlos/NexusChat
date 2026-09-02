import type { RateLimitPolicy } from "../security/rate-limit.js";
import type { MetricsPort } from "../observability/metrics.port.js";
import { noopMetrics } from "../observability/noop-metrics.js";
import { recordSocketRateLimitProviderFailure } from "../observability/realtime-metrics.js";
import { SocketEventRateLimiter } from "./socket-security.js";
import type { SocketEventRateLimitPort } from "./socket-event-rate-limit.port.js";

export class LocalSocketEventRateLimitAdapter implements SocketEventRateLimitPort {
  constructor(
    private readonly limiter: SocketEventRateLimiter = new SocketEventRateLimiter(),
    private readonly metrics: MetricsPort = noopMetrics,
  ) {}

  async consume(
    policy: RateLimitPolicy,
    keyParts: readonly string[],
  ): Promise<boolean> {
    try {
      return this.limiter.consume(policy, keyParts);
    } catch (error) {
      recordSocketRateLimitProviderFailure(this.metrics, "local");
      throw error;
    }
  }

  async consumeAll(
    policies: readonly RateLimitPolicy[],
    keyParts: readonly string[],
  ): Promise<boolean> {
    try {
      return this.limiter.consumeAll(policies, keyParts);
    } catch (error) {
      recordSocketRateLimitProviderFailure(this.metrics, "local");
      throw error;
    }
  }

  clear(): void {
    this.limiter.clear();
  }
}

export const createLocalSocketEventRateLimitProvider = (
  limiter?: SocketEventRateLimiter,
  metrics: MetricsPort = noopMetrics,
): LocalSocketEventRateLimitAdapter => new LocalSocketEventRateLimitAdapter(
  limiter,
  metrics,
);
