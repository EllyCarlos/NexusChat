import { createPinoLogger } from "../infrastructure/logging/pino-logger.adapter.js";
import type {
  LogEnvironment,
  LogRuntimeMode,
} from "../observability/log-event.types.js";
import type { LoggerPort } from "../observability/logger.port.js";

export type ProcessLoggerOptions = {
  readonly environment: LogEnvironment;
  readonly runtimeMode: LogRuntimeMode;
};

export const createProcessLogger = ({
  environment,
  runtimeMode,
}: ProcessLoggerOptions): LoggerPort => createPinoLogger({
  environment,
  runtimeMode,
  component: "bootstrap",
});
