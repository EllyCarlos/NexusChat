import type {
  LogEventFields,
  LogEventName,
  LoggerComponent,
} from "./log-event.types.js";
import type { LoggerPort } from "./logger.port.js";

const createNoopLogger = (component: LoggerComponent): LoggerPort => Object.freeze({
  component,
  forComponent: createNoopLogger,
  debug: (_event: LogEventName, _fields?: LogEventFields) => undefined,
  info: (_event: LogEventName, _fields?: LogEventFields) => undefined,
  warn: (_event: LogEventName, _fields?: LogEventFields) => undefined,
  error: (_event: LogEventName, _fields?: LogEventFields) => undefined,
});

export const noopLogger = createNoopLogger("application");
