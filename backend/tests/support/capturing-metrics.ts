import type {
  AggregateMetricResult,
  HttpRequestMetricCompletion,
  MetricsPort,
  RedisRuntimeStateMetric,
  SocketConnectionAdmissionMetric,
  SocketMetricOperation,
  SocketRateLimitProvider,
} from "../../src/observability/metrics.port.js";
import type {
  LogHttpMethod,
  LogRuntimeMode,
} from "../../src/observability/log-event.types.js";

export type CapturedHttpMetric = HttpRequestMetricCompletion & {
  readonly method: LogHttpMethod;
};

export const createCapturingMetrics = (): MetricsPort & {
  readonly starts: LogHttpMethod[];
  readonly completions: CapturedHttpMetric[];
  readonly inProgress: ReadonlyMap<LogHttpMethod, number>;
  readonly socketAdmissions: SocketConnectionAdmissionMetric[];
  readonly socketConnectionStarts: LogRuntimeMode[];
  readonly socketConnectionCompletions: LogRuntimeMode[];
  readonly activeSocketConnections: ReadonlyMap<LogRuntimeMode, number>;
  readonly socketOperationFailures: SocketMetricOperation[];
  readonly socketRateLimitRejections: SocketMetricOperation[];
  readonly socketRateLimitProviderFailures: SocketRateLimitProvider[];
  readonly redisRuntimeStates: RedisRuntimeStateMetric[];
  readonly connectionMaintenanceResults: AggregateMetricResult[];
  readonly presenceReconciliationResults: AggregateMetricResult[];
} => {
  const starts: LogHttpMethod[] = [];
  const completions: CapturedHttpMetric[] = [];
  const active = new Map<LogHttpMethod, number>();
  const socketAdmissions: SocketConnectionAdmissionMetric[] = [];
  const socketConnectionStarts: LogRuntimeMode[] = [];
  const socketConnectionCompletions: LogRuntimeMode[] = [];
  const activeSocketConnections = new Map<LogRuntimeMode, number>();
  const socketOperationFailures: SocketMetricOperation[] = [];
  const socketRateLimitRejections: SocketMetricOperation[] = [];
  const socketRateLimitProviderFailures: SocketRateLimitProvider[] = [];
  const redisRuntimeStates: RedisRuntimeStateMetric[] = [];
  const connectionMaintenanceResults: AggregateMetricResult[] = [];
  const presenceReconciliationResults: AggregateMetricResult[] = [];

  return {
    starts,
    completions,
    get inProgress() {
      return active;
    },
    socketAdmissions,
    socketConnectionStarts,
    socketConnectionCompletions,
    get activeSocketConnections() {
      return activeSocketConnections;
    },
    socketOperationFailures,
    socketRateLimitRejections,
    socketRateLimitProviderFailures,
    redisRuntimeStates,
    connectionMaintenanceResults,
    presenceReconciliationResults,
    startHttpRequest: ({ method }) => {
      starts.push(method);
      active.set(method, (active.get(method) ?? 0) + 1);
      let completed = false;
      return {
        complete: (completion) => {
          if (completed) return;
          completed = true;
          active.set(method, Math.max(0, (active.get(method) ?? 0) - 1));
          completions.push({ method, ...completion });
        },
      };
    },
    recordSocketConnectionAdmission: (metric) => {
      socketAdmissions.push(metric);
    },
    startSocketConnection: ({ runtimeMode }) => {
      socketConnectionStarts.push(runtimeMode);
      activeSocketConnections.set(
        runtimeMode,
        (activeSocketConnections.get(runtimeMode) ?? 0) + 1,
      );
      let completed = false;
      return {
        complete: () => {
          if (completed) return;
          completed = true;
          activeSocketConnections.set(
            runtimeMode,
            Math.max(0, (activeSocketConnections.get(runtimeMode) ?? 0) - 1),
          );
          socketConnectionCompletions.push(runtimeMode);
        },
      };
    },
    recordSocketOperationFailure: (operation) => {
      socketOperationFailures.push(operation);
    },
    recordSocketRateLimitRejection: (operation) => {
      socketRateLimitRejections.push(operation);
    },
    recordSocketRateLimitProviderFailure: (provider) => {
      socketRateLimitProviderFailures.push(provider);
    },
    recordRedisRuntimeState: (metric) => {
      redisRuntimeStates.push(metric);
    },
    startConnectionMaintenance: () => {
      let completed = false;
      return {
        complete: (result) => {
          if (completed) return;
          completed = true;
          connectionMaintenanceResults.push(result);
        },
      };
    },
    startPresenceReconciliation: () => {
      let completed = false;
      return {
        complete: (result) => {
          if (completed) return;
          completed = true;
          presenceReconciliationResults.push(result);
        },
      };
    },
    render: async () => ({
      contentType: "text/plain; version=0.0.4; charset=utf-8",
      body: "captured_metrics 1\n",
    }),
  };
};
