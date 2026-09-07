import type { Request } from "express";

import type { LoggerComponent } from "./log-event.types.js";
import type { LoggerPort } from "./logger.port.js";
import { noopLogger } from "./noop-logger.js";
import { createRequestContextLogger } from "./request-context-logger.js";

export const getRequestLogger = (
  request: Pick<Request, "app">,
  component: LoggerComponent,
): LoggerPort => {
  const configuredLogger = request.app?.get?.("logger") as LoggerPort | undefined;
  return createRequestContextLogger(
    (configuredLogger ?? noopLogger).forComponent(component),
  );
};
