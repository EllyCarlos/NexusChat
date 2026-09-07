import { ApplicationError } from "../errors/application-error.js";
import type {
  AggregateMetricResult,
  AggregateMetricLifecycle,
  MetricsPort,
  RedisRuntimeStateMetric,
  SocketConnectionAdmissionMetric,
  SocketConnectionMetricLifecycle,
  SocketConnectionMetricStart,
  SocketMetricOperation,
  SocketRateLimitProvider,
} from "./metrics.port.js";

const noopSocketConnectionLifecycle: SocketConnectionMetricLifecycle = Object.freeze({
  complete: () => undefined,
});

const noopAggregateLifecycle: AggregateMetricLifecycle = Object.freeze({
  complete: () => undefined,
});

export const recordSocketConnectionAdmission = (
  metrics: MetricsPort,
  metric: SocketConnectionAdmissionMetric,
): void => {
  try {
    metrics.recordSocketConnectionAdmission(metric);
  } catch {
    // Metrics must never alter connection admission.
  }
};

export const startSocketConnectionMetric = (
  metrics: MetricsPort,
  start: SocketConnectionMetricStart,
): SocketConnectionMetricLifecycle => {
  try {
    const lifecycle = metrics.startSocketConnection(start);
    let completed = false;
    return Object.freeze({
      complete: () => {
        if (completed) return;
        completed = true;
        try {
          lifecycle.complete();
        } catch {
          // Metrics must never alter disconnect cleanup.
        }
      },
    });
  } catch {
    return noopSocketConnectionLifecycle;
  }
};

const isExpectedSocketOperationError = (error: unknown): boolean =>
  error instanceof ApplicationError
  && error.statusCode !== undefined
  && error.statusCode >= 400
  && error.statusCode < 500;

export const recordUnexpectedSocketOperationFailure = (
  metrics: MetricsPort,
  operation: SocketMetricOperation,
  error: unknown,
): void => {
  if (isExpectedSocketOperationError(error)) return;
  recordSocketOperationFailure(metrics, operation);
};

export const recordSocketOperationFailure = (
  metrics: MetricsPort,
  operation: SocketMetricOperation,
): void => {
  try {
    metrics.recordSocketOperationFailure(operation);
  } catch {
    // Metrics must never alter Socket error handling.
  }
};

export const recordSocketRateLimitRejection = (
  metrics: MetricsPort,
  operation: SocketMetricOperation,
): void => {
  try {
    metrics.recordSocketRateLimitRejection(operation);
  } catch {
    // Metrics must never alter rate-limit enforcement.
  }
};

export const recordSocketRateLimitProviderFailure = (
  metrics: MetricsPort,
  provider: SocketRateLimitProvider,
): void => {
  try {
    metrics.recordSocketRateLimitProviderFailure(provider);
  } catch {
    // Metrics must never replace the provider failure.
  }
};

export const recordRedisRuntimeState = (
  metrics: MetricsPort,
  metric: RedisRuntimeStateMetric,
): void => {
  try {
    metrics.recordRedisRuntimeState(metric);
  } catch {
    // Metrics must never alter Redis lifecycle behavior.
  }
};

const startAggregateMetric = (
  operation: () => AggregateMetricLifecycle,
): AggregateMetricLifecycle => {
  try {
    const lifecycle = operation();
    let completed = false;
    return Object.freeze({
      complete: (result: AggregateMetricResult) => {
        if (completed) return;
        completed = true;
        try {
          lifecycle.complete(result);
        } catch {
          // Metrics must never alter the observed operation.
        }
      },
    });
  } catch {
    return noopAggregateLifecycle;
  }
};

export const startConnectionMaintenanceMetric = (
  metrics: MetricsPort,
): AggregateMetricLifecycle => startAggregateMetric(
  () => metrics.startConnectionMaintenance(),
);

export const startPresenceReconciliationMetric = (
  metrics: MetricsPort,
): AggregateMetricLifecycle => startAggregateMetric(
  () => metrics.startPresenceReconciliation(),
);
