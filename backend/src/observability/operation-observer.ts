import type {
  LogEventFields,
  LogEventName,
  LogLevel,
  LoggerComponent,
} from "./log-event.types.js";
import type { LoggerPort } from "./logger.port.js";
import { getSafeErrorMetadata } from "./safe-error.js";

export type OperationClock = () => number;

export const selectOperationLoggerComponent = (
  logger: LoggerPort,
  component: LoggerComponent,
): LoggerPort => {
  try {
    return logger.forComponent(component);
  } catch {
    return logger;
  }
};

export const operationDuration = (
  startedAt: number,
  clock: OperationClock,
): number => {
  const duration = clock() - startedAt;
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
};

export const emitOperationLog = (
  logger: LoggerPort,
  level: LogLevel,
  event: LogEventName,
  fields?: LogEventFields,
): void => {
  try {
    logger[level](event, fields);
  } catch {
    // Operational observability must never alter application behavior.
  }
};

export const emitOperationError = (
  logger: LoggerPort,
  event: LogEventName,
  error: unknown,
  fields?: Omit<LogEventFields, "errorType" | "applicationCode">,
): void => {
  let metadata: ReturnType<typeof getSafeErrorMetadata>;
  try {
    metadata = getSafeErrorMetadata(error);
  } catch {
    metadata = Object.freeze({ errorType: "UnknownError" });
  }

  emitOperationLog(logger, "error", event, {
    ...fields,
    ...metadata,
  });
};
