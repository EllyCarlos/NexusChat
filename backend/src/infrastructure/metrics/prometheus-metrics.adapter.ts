import {
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";
import { performance } from "node:perf_hooks";

import type {
  AggregateMetricResult,
  AggregateMetricLifecycle,
  HttpRequestMetricCompletion,
  HttpRequestMetricStart,
  MetricsPort,
  RedisRuntimeStateMetric,
  SocketConnectionAdmissionMetric,
  SocketConnectionMetricStart,
  SocketConnectionMetricLifecycle,
  SocketMetricOperation,
  SocketRateLimitProvider,
} from "../../observability/metrics.port.js";

export const HTTP_REQUEST_DURATION_BUCKETS_SECONDS = [
  0.005,
  0.01,
  0.025,
  0.05,
  0.1,
  0.25,
  0.5,
  1,
  2.5,
  5,
  10,
] as const;

export const SOCKET_CONNECTION_DURATION_BUCKETS_SECONDS = [
  1,
  5,
  15,
  30,
  60,
  300,
  900,
  1_800,
  3_600,
  7_200,
  21_600,
  86_400,
] as const;

export const REALTIME_OPERATION_DURATION_BUCKETS_SECONDS = [
  0.001,
  0.005,
  0.01,
  0.025,
  0.05,
  0.1,
  0.25,
  0.5,
  1,
  2.5,
  5,
  10,
  30,
] as const;

const safely = (operation: () => void): boolean => {
  try {
    operation();
    return true;
  } catch {
    return false;
  }
};

const safeDuration = (durationSeconds: number): number =>
  Number.isFinite(durationSeconds) && durationSeconds >= 0 ? durationSeconds : 0;

type MetricsClock = () => number;

const readClock = (clock: MetricsClock): number => {
  try {
    const value = clock();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
};

const elapsedSeconds = (startedAt: number, clock: MetricsClock): number =>
  safeDuration((readClock(clock) - startedAt) / 1_000);

export const createPrometheusMetricsAdapter = ({
  clock = performance.now.bind(performance),
}: {
  readonly clock?: MetricsClock;
} = {}): MetricsPort => {
  const registry = new Registry();
  const requestCounter = new Counter({
    name: "nexuschat_http_requests_total",
    help: "Total HTTP requests completed",
    labelNames: ["method", "route", "status_class"] as const,
    registers: [registry],
  });
  const requestDuration = new Histogram({
    name: "nexuschat_http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_class"] as const,
    buckets: [...HTTP_REQUEST_DURATION_BUCKETS_SECONDS],
    registers: [registry],
  });
  const requestsInProgress = new Gauge({
    name: "nexuschat_http_requests_in_progress",
    help: "HTTP requests currently in progress",
    labelNames: ["method"] as const,
    registers: [registry],
  });
  const activeSocketConnections = new Gauge({
    name: "nexuschat_socket_connections_active",
    help: "Socket connections currently active in this backend process",
    labelNames: ["runtime_mode"] as const,
    registers: [registry],
  });
  const socketConnectionAdmissions = new Counter({
    name: "nexuschat_socket_connection_admissions_total",
    help: "Socket connection admission decisions",
    labelNames: ["result", "reason"] as const,
    registers: [registry],
  });
  const socketConnectionDuration = new Histogram({
    name: "nexuschat_socket_connection_duration_seconds",
    help: "Duration of accepted Socket connections",
    labelNames: ["runtime_mode"] as const,
    buckets: [...SOCKET_CONNECTION_DURATION_BUCKETS_SECONDS],
    registers: [registry],
  });
  const socketOperationFailures = new Counter({
    name: "nexuschat_socket_operation_failures_total",
    help: "Unexpected Socket operation failures",
    labelNames: ["operation"] as const,
    registers: [registry],
  });
  const socketRateLimitRejections = new Counter({
    name: "nexuschat_socket_rate_limit_rejections_total",
    help: "Socket operations rejected by rate limiting",
    labelNames: ["operation"] as const,
    registers: [registry],
  });
  const socketRateLimitProviderFailures = new Counter({
    name: "nexuschat_socket_rate_limit_provider_failures_total",
    help: "Socket rate-limit provider evaluation failures",
    labelNames: ["provider"] as const,
    registers: [registry],
  });
  const redisRuntimeReady = new Gauge({
    name: "nexuschat_redis_runtime_ready",
    help: "Redis runtime readiness by connection role",
    labelNames: ["role"] as const,
    registers: [registry],
  });
  const redisStateTransitions = new Counter({
    name: "nexuschat_redis_state_transitions_total",
    help: "Redis runtime lifecycle transitions",
    labelNames: ["role", "state"] as const,
    registers: [registry],
  });
  const connectionMaintenanceRuns = new Counter({
    name: "nexuschat_connection_maintenance_runs_total",
    help: "Distributed connection-maintenance runs",
    labelNames: ["result"] as const,
    registers: [registry],
  });
  const connectionMaintenanceDuration = new Histogram({
    name: "nexuschat_connection_maintenance_duration_seconds",
    help: "Distributed connection-maintenance duration",
    labelNames: ["result"] as const,
    buckets: [...REALTIME_OPERATION_DURATION_BUCKETS_SECONDS],
    registers: [registry],
  });
  const presenceReconciliations = new Counter({
    name: "nexuschat_presence_reconciliations_total",
    help: "Aggregate distributed presence reconciliation runs",
    labelNames: ["result"] as const,
    registers: [registry],
  });
  const presenceReconciliationDuration = new Histogram({
    name: "nexuschat_presence_reconciliation_duration_seconds",
    help: "Aggregate distributed presence reconciliation duration",
    labelNames: ["result"] as const,
    buckets: [...REALTIME_OPERATION_DURATION_BUCKETS_SECONDS],
    registers: [registry],
  });

  const startAggregateMetric = (
    counter: Counter<"result">,
    duration: Histogram<"result">,
  ): AggregateMetricLifecycle => {
    const startedAt = readClock(clock);
    let completed = false;
    return Object.freeze({
      complete: (result: AggregateMetricResult) => {
        if (completed) return;
        completed = true;
        const labels = { result };
        safely(() => counter.inc(labels));
        safely(() => duration.observe(labels, elapsedSeconds(startedAt, clock)));
      },
    });
  };

  return Object.freeze({
    startHttpRequest: ({ method }: HttpRequestMetricStart) => {
      const gaugeIncremented = safely(() => requestsInProgress.inc({ method }));
      let completed = false;

      return Object.freeze({
        complete: ({
          route,
          statusClass,
          durationSeconds,
        }: HttpRequestMetricCompletion) => {
          if (completed) return;
          completed = true;

          if (gaugeIncremented) {
            safely(() => requestsInProgress.dec({ method }));
          }
          const labels = { method, route, status_class: statusClass };
          safely(() => requestCounter.inc(labels));
          safely(() => requestDuration.observe(labels, safeDuration(durationSeconds)));
        },
      });
    },
    recordSocketConnectionAdmission: ({
      result,
      reason,
    }: SocketConnectionAdmissionMetric) => {
      safely(() => socketConnectionAdmissions.inc({ result, reason }));
    },
    startSocketConnection: ({
      runtimeMode,
    }: SocketConnectionMetricStart): SocketConnectionMetricLifecycle => {
      const startedAt = readClock(clock);
      const gaugeIncremented = safely(() => activeSocketConnections.inc({
        runtime_mode: runtimeMode,
      }));
      let completed = false;
      return Object.freeze({
        complete: () => {
          if (completed) return;
          completed = true;
          if (gaugeIncremented) {
            safely(() => activeSocketConnections.dec({ runtime_mode: runtimeMode }));
          }
          safely(() => socketConnectionDuration.observe(
            { runtime_mode: runtimeMode },
            elapsedSeconds(startedAt, clock),
          ));
        },
      });
    },
    recordSocketOperationFailure: (operation: SocketMetricOperation) => {
      safely(() => socketOperationFailures.inc({ operation }));
    },
    recordSocketRateLimitRejection: (operation: SocketMetricOperation) => {
      safely(() => socketRateLimitRejections.inc({ operation }));
    },
    recordSocketRateLimitProviderFailure: (provider: SocketRateLimitProvider) => {
      safely(() => socketRateLimitProviderFailures.inc({ provider }));
    },
    recordRedisRuntimeState: ({ role, state }: RedisRuntimeStateMetric) => {
      safely(() => redisRuntimeReady.set({ role }, state === "ready" ? 1 : 0));
      safely(() => redisStateTransitions.inc({ role, state }));
    },
    startConnectionMaintenance: () => startAggregateMetric(
      connectionMaintenanceRuns,
      connectionMaintenanceDuration,
    ),
    startPresenceReconciliation: () => startAggregateMetric(
      presenceReconciliations,
      presenceReconciliationDuration,
    ),
    render: async () => ({
      contentType: registry.contentType,
      body: await registry.metrics(),
    }),
  });
};
