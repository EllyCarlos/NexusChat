import type {
  LogEventFields,
  LogEventName,
  LogLevel,
  LoggerComponent,
} from "../../src/observability/log-event.types.js";
import {
  isLogEventName,
  selectAllowedLogFields,
} from "../../src/observability/log-event.types.js";
import type { LoggerPort } from "../../src/observability/logger.port.js";

export interface CapturedLogEvent {
  readonly level: LogLevel;
  readonly event: LogEventName;
  readonly component: LoggerComponent;
  readonly fields: LogEventFields;
}

export class CapturingLogger implements LoggerPort {
  constructor(
    readonly component: LoggerComponent,
    private readonly capturedEvents: CapturedLogEvent[] = [],
  ) {}

  get events(): readonly CapturedLogEvent[] {
    return this.capturedEvents.map((event) => Object.freeze({
      ...event,
      fields: Object.freeze({ ...event.fields }),
    }));
  }

  forComponent(component: LoggerComponent): LoggerPort {
    return new CapturingLogger(component, this.capturedEvents);
  }

  debug(event: LogEventName, fields?: LogEventFields): void {
    this.capture("debug", event, fields);
  }

  info(event: LogEventName, fields?: LogEventFields): void {
    this.capture("info", event, fields);
  }

  warn(event: LogEventName, fields?: LogEventFields): void {
    this.capture("warn", event, fields);
  }

  error(event: LogEventName, fields?: LogEventFields): void {
    this.capture("error", event, fields);
  }

  reset(): void {
    this.capturedEvents.length = 0;
  }

  private capture(
    level: LogLevel,
    event: LogEventName,
    fields?: LogEventFields,
  ): void {
    try {
      if (!isLogEventName(event)) return;
      this.capturedEvents.push(Object.freeze({
        level,
        event,
        component: this.component,
        fields: selectAllowedLogFields(fields),
      }));
    } catch {
      // The test implementation follows the same never-throw contract.
    }
  }
}

export const createCapturingLogger = (
  component: LoggerComponent,
): CapturingLogger => new CapturingLogger(component);
