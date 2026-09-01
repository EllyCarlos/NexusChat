import pino from "pino";

import type {
  LogEnvironment,
  LogEventFields,
  LogEventName,
  LoggerComponent,
  LoggerMinimumLevel,
  LoggerProcessBindings,
  LogRuntimeMode,
} from "../../observability/log-event.types.js";
import {
  isLogEventName,
  selectAllowedLogFields,
} from "../../observability/log-event.types.js";
import type { LoggerPort } from "../../observability/logger.port.js";

export const NEXUSCHAT_BACKEND_SERVICE = "nexuschat-backend" as const;
export const LOGGER_FAILURE_FALLBACK_MESSAGE = "Structured logger failed.\n";

export interface LoggerDestination {
  write(message: string): void;
}

type PinoLoggerAdapterOptions = {
  readonly environment: LogEnvironment;
  readonly runtimeMode: LogRuntimeMode;
  readonly component: LoggerComponent;
  readonly minimumLevel?: LoggerMinimumLevel;
  readonly destination?: LoggerDestination;
  readonly fallback?: (message: string) => void;
};

type LoggerFailureState = {
  fallbackReported: boolean;
};

const defaultMinimumLevel = (
  environment: LogEnvironment,
): LoggerMinimumLevel => {
  if (environment === "production") return "info";
  if (environment === "test") return "silent";
  return "debug";
};

const stdoutDestination: LoggerDestination = {
  write(message) {
    process.stdout.write(message);
  },
};

const stderrFallback = (message: string): void => {
  process.stderr.write(message);
};

const createFailureReporter = (
  state: LoggerFailureState,
  fallback: (message: string) => void,
) => (): void => {
  if (state.fallbackReported) return;
  state.fallbackReported = true;
  try {
    fallback(LOGGER_FAILURE_FALLBACK_MESSAGE);
  } catch {
    // Observability failures must never escape into application logic.
  }
};

const createGuardedDestination = (
  destination: LoggerDestination,
  reportFailure: () => void,
): LoggerDestination => ({
  write(message) {
    try {
      destination.write(message);
    } catch {
      reportFailure();
    }
  },
});

const createBoundLogger = ({
  pinoLogger,
  component,
  reportFailure,
}: {
  pinoLogger: pino.Logger;
  component: LoggerComponent;
  reportFailure: () => void;
}): LoggerPort => {
  const boundPinoLogger = pinoLogger.child({ component });

  const write = (
    level: "debug" | "info" | "warn" | "error",
    event: LogEventName,
    fields?: LogEventFields,
  ): void => {
    try {
      if (!isLogEventName(event)) {
        reportFailure();
        return;
      }
      boundPinoLogger[level]({
        event,
        ...selectAllowedLogFields(fields),
      });
    } catch {
      reportFailure();
    }
  };

  return Object.freeze({
    component,
    forComponent: (nextComponent: LoggerComponent) => createBoundLogger({
      pinoLogger,
      component: nextComponent,
      reportFailure,
    }),
    debug: (event: LogEventName, fields?: LogEventFields) =>
      write("debug", event, fields),
    info: (event: LogEventName, fields?: LogEventFields) =>
      write("info", event, fields),
    warn: (event: LogEventName, fields?: LogEventFields) =>
      write("warn", event, fields),
    error: (event: LogEventName, fields?: LogEventFields) =>
      write("error", event, fields),
  });
};

export const createPinoLogger = ({
  environment,
  runtimeMode,
  component,
  minimumLevel = defaultMinimumLevel(environment),
  destination = stdoutDestination,
  fallback = stderrFallback,
}: PinoLoggerAdapterOptions): LoggerPort => {
  const processBindings: LoggerProcessBindings = Object.freeze({
    service: NEXUSCHAT_BACKEND_SERVICE,
    environment,
    runtimeMode,
  });
  const failureState: LoggerFailureState = { fallbackReported: false };
  const reportFailure = createFailureReporter(failureState, fallback);
  const guardedDestination = createGuardedDestination(destination, reportFailure);
  const pinoLogger = pino({
    level: minimumLevel,
    base: processBindings,
    timestamp: pino.stdTimeFunctions.epochTime,
  }, guardedDestination);

  return createBoundLogger({
    pinoLogger,
    component,
    reportFailure,
  });
};
