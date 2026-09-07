import type {
  AggregateMetricLifecycle,
  HttpRequestMetricLifecycle,
  MetricsPort,
  SocketConnectionMetricLifecycle,
} from "./metrics.port.js";

const noopHttpRequestMetricLifecycle: HttpRequestMetricLifecycle = Object.freeze({
  complete: () => undefined,
});

const noopSocketConnectionMetricLifecycle: SocketConnectionMetricLifecycle = Object.freeze({
  complete: () => undefined,
});

const noopAggregateMetricLifecycle: AggregateMetricLifecycle = Object.freeze({
  complete: () => undefined,
});

export const noopMetrics: MetricsPort = Object.freeze({
  startHttpRequest: () => noopHttpRequestMetricLifecycle,
  recordSocketConnectionAdmission: () => undefined,
  startSocketConnection: () => noopSocketConnectionMetricLifecycle,
  recordSocketOperationFailure: () => undefined,
  recordSocketRateLimitRejection: () => undefined,
  recordSocketRateLimitProviderFailure: () => undefined,
  recordRedisRuntimeState: () => undefined,
  startConnectionMaintenance: () => noopAggregateMetricLifecycle,
  startPresenceReconciliation: () => noopAggregateMetricLifecycle,
  render: async () => ({
    contentType: "text/plain; version=0.0.4; charset=utf-8",
    body: "",
  }),
});
