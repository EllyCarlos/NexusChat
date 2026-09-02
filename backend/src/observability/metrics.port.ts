import type {
  LogHttpMethod,
  LogRedisRole,
  LogRedisState,
  LogRuntimeMode,
} from "./log-event.types.js";

export const HTTP_STATUS_CLASSES = [
  "1xx",
  "2xx",
  "3xx",
  "4xx",
  "5xx",
  "other",
] as const;

export type HttpStatusClass = typeof HTTP_STATUS_CLASSES[number];

export type HttpRequestMetricStart = {
  readonly method: LogHttpMethod;
};

export type HttpRequestMetricCompletion = {
  readonly route: string;
  readonly statusClass: HttpStatusClass;
  readonly durationSeconds: number;
};

export interface HttpRequestMetricLifecycle {
  complete(completion: HttpRequestMetricCompletion): void;
}

export type MetricsExposition = {
  readonly contentType: string;
  readonly body: string;
};

export const SOCKET_METRIC_OPERATIONS = [
  "message_send",
  "message_seen",
  "message_edit",
  "message_delete",
  "typing",
  "reaction_add",
  "reaction_delete",
  "poll_vote",
  "poll_vote_remove",
  "message_pin",
  "message_unpin",
  "call_user",
  "call_accept",
  "call_reject",
  "call_end",
  "callee_busy",
  "ice_candidate",
  "negotiation_needed",
  "negotiation_done",
] as const;

export type SocketMetricOperation = typeof SOCKET_METRIC_OPERATIONS[number];

export type SocketConnectionAdmissionResult = "accepted" | "rejected" | "failed";

export type SocketConnectionAdmissionReason =
  | "none"
  | "authentication"
  | "runtime_unavailable"
  | "connection_cap"
  | "registration_failure";

export type SocketConnectionAdmissionMetric = {
  readonly result: SocketConnectionAdmissionResult;
  readonly reason: SocketConnectionAdmissionReason;
};

export type SocketConnectionMetricStart = {
  readonly runtimeMode: LogRuntimeMode;
};

export interface SocketConnectionMetricLifecycle {
  complete(): void;
}

export type SocketRateLimitProvider = "local" | "redis";
export type AggregateMetricResult = "success" | "failed";

export interface AggregateMetricLifecycle {
  complete(result: AggregateMetricResult): void;
}

export type RedisRuntimeStateMetric = {
  readonly role: LogRedisRole;
  readonly state: LogRedisState;
};

export interface MetricsPort {
  startHttpRequest(start: HttpRequestMetricStart): HttpRequestMetricLifecycle;
  recordSocketConnectionAdmission(metric: SocketConnectionAdmissionMetric): void;
  startSocketConnection(start: SocketConnectionMetricStart): SocketConnectionMetricLifecycle;
  recordSocketOperationFailure(operation: SocketMetricOperation): void;
  recordSocketRateLimitRejection(operation: SocketMetricOperation): void;
  recordSocketRateLimitProviderFailure(provider: SocketRateLimitProvider): void;
  recordRedisRuntimeState(metric: RedisRuntimeStateMetric): void;
  startConnectionMaintenance(): AggregateMetricLifecycle;
  startPresenceReconciliation(): AggregateMetricLifecycle;
  render(): Promise<MetricsExposition>;
}
