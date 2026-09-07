import type {
  LogEventFields,
  LogEventName,
  LoggerComponent,
} from "./log-event.types.js";

export interface LoggerPort {
  readonly component: LoggerComponent;
  forComponent(component: LoggerComponent): LoggerPort;
  debug(event: LogEventName, fields?: LogEventFields): void;
  info(event: LogEventName, fields?: LogEventFields): void;
  warn(event: LogEventName, fields?: LogEventFields): void;
  error(event: LogEventName, fields?: LogEventFields): void;
}
