export const LOGGER_COMPONENTS = [
  "application",
  "auth",
  "bootstrap",
  "database",
  "http",
  "notification",
  "presence",
  "provider",
  "redis",
  "socket",
  "test",
  "upload",
] as const;

export type LoggerComponent = typeof LOGGER_COMPONENTS[number];

export type LogEventName = `${LoggerComponent}.${string}`;

export const MIGRATED_LOG_EVENT_NAMES = [
  "auth.key_recovery.completed",
  "auth.key_recovery.failed",
  "auth.oauth_callback.rejected",
  "auth.oauth_initiation.failed",
  "auth.oauth_profile.failed",
  "auth.oauth_provider.failed",
  "auth.oauth_provider.rejected",
  "auth.oauth_redirect.completed",
  "auth.oauth_redirect.failed",
  "auth.socket_authentication.failed",
  "bootstrap.connection_state_shutdown.failed",
  "bootstrap.prisma_shutdown.failed",
  "bootstrap.startup.completed",
  "bootstrap.startup.started",
  "bootstrap.startup_stage.completed",
  "bootstrap.startup_stage.failed",
  "bootstrap.startup_stage.started",
  "bootstrap.shutdown.completed",
  "bootstrap.shutdown.failed",
  "bootstrap.shutdown.started",
  "bootstrap.shutdown_stage.completed",
  "bootstrap.shutdown_stage.failed",
  "bootstrap.shutdown_stage.started",
  "bootstrap.uncaught_exception.failed",
  "bootstrap.unhandled_rejection.failed",
  "http.application_request.failed",
  "http.origin_configuration.ignored",
  "http.request.completed",
  "http.unexpected_request.failed",
  "notification.email_send.failed",
  "presence.offline_update.failed",
  "presence.online_update.failed",
  "provider.email_initialization.failed",
  "provider.firebase_credentials.failed",
  "redis.connection_maintenance.recovered",
  "redis.connection_maintenance.unavailable",
  "redis.connection_state_force_close.failed",
  "redis.runtime.closed",
  "redis.runtime.connecting",
  "redis.runtime.ready",
  "redis.runtime.recovered",
  "redis.runtime.unavailable",
  "redis.socket_transport_shutdown.failed",
  "socket.audio_upload.failed",
  "socket.call_acceptance.failed",
  "socket.call_end.failed",
  "socket.call_rejection.failed",
  "socket.call_user.failed",
  "socket.callee_busy.failed",
  "socket.connection_registration.failed",
  "socket.connection_removal.failed",
  "socket.encrypted_audio_upload.failed",
  "socket.ice_candidate.failed",
  "socket.message_delete.failed",
  "socket.message_edit.failed",
  "socket.message_pin.failed",
  "socket.message_retrieval.failed",
  "socket.message_seen.failed",
  "socket.message_send.failed",
  "socket.message_unpin.failed",
  "socket.negotiation_done.failed",
  "socket.negotiation_needed.failed",
  "socket.offline_presence_update.failed",
  "socket.online_presence_update.failed",
  "socket.online_users_lookup.failed",
  "socket.poll_vote.failed",
  "socket.poll_vote_removal.failed",
  "socket.reaction_addition.failed",
  "socket.reaction_deletion.failed",
  "socket.room_initialization.failed",
  "socket.typing.failed",
] as const satisfies readonly LogEventName[];

export type LogEnvironment = "development" | "production" | "test";
export type LogRuntimeMode = "local" | "distributed";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LoggerMinimumLevel = LogLevel | "silent";

export type LogErrorCategory =
  | "validation"
  | "authentication"
  | "authorization"
  | "domain"
  | "database"
  | "redis"
  | "provider"
  | "configuration"
  | "timeout"
  | "unknown";

export type LogOperationResult =
  | "accepted"
  | "aborted"
  | "available"
  | "client_error"
  | "completed"
  | "failed"
  | "redirect"
  | "recovered"
  | "rejected"
  | "server_error"
  | "started"
  | "success"
  | "succeeded"
  | "unavailable";

export type LogHttpMethod =
  | "DELETE"
  | "GET"
  | "HEAD"
  | "OPTIONS"
  | "PATCH"
  | "POST"
  | "PUT"
  | "OTHER";

export const LOG_LIFECYCLE_STAGES = [
  "connection_state_construction",
  "server_construction",
  "socket_transport",
  "connection_state_connect",
  "connection_maintenance",
  "process_handlers",
  "http_listen",
  "socket_admission_drain",
  "http_server_shutdown",
  "local_socket_disconnect",
  "socket_operation_drain",
  "socket_io_shutdown",
  "socket_operation_drain_after_socket_io",
  "connection_state_shutdown",
  "distributed_realtime_shutdown",
  "prisma_shutdown",
] as const;

export type LogLifecycleStage = typeof LOG_LIFECYCLE_STAGES[number];

export const LOG_REDIS_ROLES = ["publisher", "subscriber", "command"] as const;
export type LogRedisRole = typeof LOG_REDIS_ROLES[number];

export const LOG_REDIS_STATES = [
  "connecting",
  "ready",
  "unavailable",
  "closed",
] as const;
export type LogRedisState = typeof LOG_REDIS_STATES[number];

export const LOG_SHUTDOWN_REASONS = [
  "manual",
  "sigterm",
  "sigint",
  "uncaught_exception",
  "unhandled_rejection",
  "startup_failure",
] as const;
export type LogShutdownReason = typeof LOG_SHUTDOWN_REASONS[number];

export interface LogEventFields {
  readonly operation?: string;
  readonly result?: LogOperationResult;
  readonly durationMs?: number;
  readonly responseSizeBytes?: number;
  readonly statusCode?: number;
  readonly route?: string;
  readonly method?: LogHttpMethod;
  readonly stage?: LogLifecycleStage;
  readonly role?: LogRedisRole;
  readonly state?: LogRedisState;
  readonly reason?: LogShutdownReason;
  readonly errorCategory?: LogErrorCategory;
  readonly errorType?: string;
  readonly applicationCode?: string;
  readonly requestId?: string;
}

export interface LoggerProcessBindings {
  readonly service: "nexuschat-backend";
  readonly environment: LogEnvironment;
  readonly runtimeMode: LogRuntimeMode;
}

const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,4}$/;
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const SAFE_ROUTE_PATTERN = /^[A-Za-z0-9_/:.*-]+$/;

const LOG_OPERATION_RESULTS = new Set<LogOperationResult>([
  "accepted",
  "aborted",
  "available",
  "client_error",
  "completed",
  "failed",
  "redirect",
  "recovered",
  "rejected",
  "server_error",
  "started",
  "success",
  "succeeded",
  "unavailable",
]);

const LOG_HTTP_METHODS = new Set<LogHttpMethod>([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "OTHER",
]);

const LOG_ERROR_CATEGORIES = new Set<LogErrorCategory>([
  "validation",
  "authentication",
  "authorization",
  "domain",
  "database",
  "redis",
  "provider",
  "configuration",
  "timeout",
  "unknown",
]);

const LOG_LIFECYCLE_STAGE_VALUES = new Set<LogLifecycleStage>(LOG_LIFECYCLE_STAGES);
const LOG_REDIS_ROLE_VALUES = new Set<LogRedisRole>(LOG_REDIS_ROLES);
const LOG_REDIS_STATE_VALUES = new Set<LogRedisState>(LOG_REDIS_STATES);
const LOG_SHUTDOWN_REASON_VALUES = new Set<LogShutdownReason>(LOG_SHUTDOWN_REASONS);

const isSafeToken = (value: unknown, maximumLength = 128): value is string =>
  typeof value === "string"
  && value.length > 0
  && value.length <= maximumLength
  && SAFE_TOKEN_PATTERN.test(value);

const isFiniteNonNegativeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export const isLogEventName = (value: unknown): value is LogEventName =>
  typeof value === "string"
  && value.length <= 160
  && EVENT_NAME_PATTERN.test(value);

export const selectAllowedLogFields = (
  fields: LogEventFields | undefined,
): LogEventFields => {
  if (!fields) return {};

  const selected: LogEventFields = {
    ...(isSafeToken(fields.operation) ? { operation: fields.operation } : {}),
    ...(LOG_OPERATION_RESULTS.has(fields.result as LogOperationResult)
      ? { result: fields.result }
      : {}),
    ...(isFiniteNonNegativeNumber(fields.durationMs)
      ? { durationMs: fields.durationMs }
      : {}),
    ...(Number.isSafeInteger(fields.responseSizeBytes)
      && fields.responseSizeBytes !== undefined
      && fields.responseSizeBytes >= 0
      ? { responseSizeBytes: fields.responseSizeBytes }
      : {}),
    ...(Number.isSafeInteger(fields.statusCode)
      && fields.statusCode !== undefined
      && fields.statusCode >= 100
      && fields.statusCode <= 599
      ? { statusCode: fields.statusCode }
      : {}),
    ...(typeof fields.route === "string"
      && fields.route.length > 0
      && fields.route.length <= 256
      && SAFE_ROUTE_PATTERN.test(fields.route)
      ? { route: fields.route }
      : {}),
    ...(LOG_HTTP_METHODS.has(fields.method as LogHttpMethod)
      ? { method: fields.method }
      : {}),
    ...(LOG_LIFECYCLE_STAGE_VALUES.has(fields.stage as LogLifecycleStage)
      ? { stage: fields.stage }
      : {}),
    ...(LOG_REDIS_ROLE_VALUES.has(fields.role as LogRedisRole)
      ? { role: fields.role }
      : {}),
    ...(LOG_REDIS_STATE_VALUES.has(fields.state as LogRedisState)
      ? { state: fields.state }
      : {}),
    ...(LOG_SHUTDOWN_REASON_VALUES.has(fields.reason as LogShutdownReason)
      ? { reason: fields.reason }
      : {}),
    ...(LOG_ERROR_CATEGORIES.has(fields.errorCategory as LogErrorCategory)
      ? { errorCategory: fields.errorCategory }
      : {}),
    ...(isSafeToken(fields.errorType) ? { errorType: fields.errorType } : {}),
    ...(isSafeToken(fields.applicationCode)
      ? { applicationCode: fields.applicationCode }
      : {}),
    ...(typeof fields.requestId === "string"
      && fields.requestId.length > 0
      && fields.requestId.length <= 64
      && SAFE_REQUEST_ID_PATTERN.test(fields.requestId)
      ? { requestId: fields.requestId }
      : {}),
  };

  return Object.freeze(selected);
};
