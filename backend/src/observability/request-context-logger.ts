import type {
  LogEventFields,
  LogEventName,
  LoggerComponent,
} from "./log-event.types.js";
import type { LoggerPort } from "./logger.port.js";
import { getRequestId } from "./request-context.js";

const enrichFields = (fields?: LogEventFields): LogEventFields | undefined => {
  const requestId = getRequestId();
  if (!requestId) return fields;
  return { ...fields, requestId };
};

export const createRequestContextLogger = (logger: LoggerPort): LoggerPort => {
  const write = (
    level: "debug" | "info" | "warn" | "error",
    event: LogEventName,
    fields?: LogEventFields,
  ): void => logger[level](event, enrichFields(fields));

  return Object.freeze({
    component: logger.component,
    forComponent: (component: LoggerComponent) =>
      createRequestContextLogger(logger.forComponent(component)),
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
