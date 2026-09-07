import { describe, expect, it } from "vitest";

import { CustomError } from "../src/errors/application-error.js";
import type { MetricsPort } from "../src/observability/metrics.port.js";
import { noopMetrics } from "../src/observability/noop-metrics.js";
import {
  recordRedisRuntimeState,
  recordSocketConnectionAdmission,
  recordSocketOperationFailure,
  recordSocketRateLimitProviderFailure,
  recordSocketRateLimitRejection,
  recordUnexpectedSocketOperationFailure,
  startConnectionMaintenanceMetric,
  startPresenceReconciliationMetric,
  startSocketConnectionMetric,
} from "../src/observability/realtime-metrics.js";
import { createCapturingMetrics } from "./support/capturing-metrics.js";

describe("provider-neutral realtime metrics safety boundary", () => {
  it("records only unexpected Socket failures from the bounded operation taxonomy", () => {
    const metrics = createCapturingMetrics();

    recordUnexpectedSocketOperationFailure(
      metrics,
      "message_send",
      new CustomError("Expected authorization rejection", 403),
    );
    recordUnexpectedSocketOperationFailure(
      metrics,
      "typing",
      new Error("private provider detail"),
    );
    recordUnexpectedSocketOperationFailure(
      metrics,
      "call_user",
      new CustomError("Unexpected server failure", 500),
    );

    expect(metrics.socketOperationFailures).toEqual(["typing", "call_user"]);
    expect(JSON.stringify(metrics.socketOperationFailures)).not.toContain("private");
  });

  it("isolates every realtime metric method and lifecycle completion failure", () => {
    const fail = () => {
      throw new Error("private metrics failure");
    };
    const throwingMetrics: MetricsPort = {
      ...noopMetrics,
      recordSocketConnectionAdmission: fail,
      startSocketConnection: () => ({ complete: fail }),
      recordSocketOperationFailure: fail,
      recordSocketRateLimitRejection: fail,
      recordSocketRateLimitProviderFailure: fail,
      recordRedisRuntimeState: fail,
      startConnectionMaintenance: () => ({ complete: fail }),
      startPresenceReconciliation: () => ({ complete: fail }),
    };
    const throwingStartMetrics: MetricsPort = {
      ...noopMetrics,
      startSocketConnection: fail,
      startConnectionMaintenance: fail,
      startPresenceReconciliation: fail,
    };

    expect(() => recordSocketConnectionAdmission(throwingMetrics, {
      result: "accepted",
      reason: "none",
    })).not.toThrow();
    expect(() => startSocketConnectionMetric(throwingMetrics, {
      runtimeMode: "distributed",
    }).complete()).not.toThrow();
    expect(() => recordSocketOperationFailure(
      throwingMetrics,
      "message_send",
    )).not.toThrow();
    expect(() => recordSocketRateLimitRejection(
      throwingMetrics,
      "typing",
    )).not.toThrow();
    expect(() => recordSocketRateLimitProviderFailure(
      throwingMetrics,
      "redis",
    )).not.toThrow();
    expect(() => recordRedisRuntimeState(throwingMetrics, {
      role: "command",
      state: "unavailable",
    })).not.toThrow();
    expect(() => startConnectionMaintenanceMetric(throwingMetrics)
      .complete("failed")).not.toThrow();
    expect(() => startPresenceReconciliationMetric(throwingMetrics)
      .complete("failed")).not.toThrow();
    expect(() => startSocketConnectionMetric(throwingStartMetrics, {
      runtimeMode: "local",
    }).complete()).not.toThrow();
    expect(() => startConnectionMaintenanceMetric(throwingStartMetrics)
      .complete("failed")).not.toThrow();
    expect(() => startPresenceReconciliationMetric(throwingStartMetrics)
      .complete("failed")).not.toThrow();
  });
});
