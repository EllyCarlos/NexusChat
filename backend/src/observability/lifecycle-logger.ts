import type {
  LogEventFields,
  LogEventName,
  LogLevel,
  LoggerComponent,
} from "./log-event.types.js";
import type { LoggerPort } from "./logger.port.js";
import { getSafeErrorMetadata } from "./safe-error.js";

export type MonotonicClock = () => number;

export const selectLifecycleLoggerComponent = (
  logger: LoggerPort,
  component: LoggerComponent,
): LoggerPort => {
  try {
    return logger.forComponent(component);
  } catch {
    return logger;
  }
};

export const getLifecycleErrorMetadata = (error: unknown) => {
  try {
    return getSafeErrorMetadata(error);
  } catch {
    return Object.freeze({ errorType: "UnknownError" as const });
  }
};

export const monotonicDuration = (
  startedAt: number,
  clock: MonotonicClock,
): number => {
  const duration = clock() - startedAt;
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
};

export const emitLifecycleLog = (
  logger: LoggerPort,
  level: LogLevel,
  event: LogEventName,
  fields?: LogEventFields,
): void => {
  try {
    logger[level](event, fields);
  } catch {
    // Observability must never change lifecycle behavior.
  }
};

export const emitLifecycleError = (
  logger: LoggerPort,
  event: LogEventName,
  error: unknown,
  fields?: Omit<LogEventFields, "errorType" | "applicationCode">,
): void => {
  emitLifecycleLog(logger, "error", event, {
    ...fields,
    ...getLifecycleErrorMetadata(error),
  });
};
