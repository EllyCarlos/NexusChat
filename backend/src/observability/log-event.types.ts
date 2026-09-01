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
  | "available"
  | "completed"
  | "failed"
  | "recovered"
  | "rejected"
  | "started"
  | "succeeded"
  | "unavailable";

export type LogHttpMethod =
  | "DELETE"
  | "GET"
  | "HEAD"
  | "OPTIONS"
  | "PATCH"
  | "POST"
  | "PUT";

export interface LogEventFields {
  readonly operation?: string;
  readonly result?: LogOperationResult;
  readonly durationMs?: number;
  readonly statusCode?: number;
  readonly route?: string;
  readonly method?: LogHttpMethod;
  readonly stage?: string;
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
  "available",
  "completed",
  "failed",
  "recovered",
  "rejected",
  "started",
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
    ...(isSafeToken(fields.stage) ? { stage: fields.stage } : {}),
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
