import { ApplicationError } from "../errors/application-error.js";
import type { LogEventFields, LogEventName } from "./log-event.types.js";
import type { LoggerPort } from "./logger.port.js";

export interface SafeErrorMetadata {
  readonly errorType: string;
  readonly applicationCode?: string;
}

const SAFE_ERROR_TYPES = new Set([
  "Error",
  "CustomError",
  "JsonWebTokenError",
  "MulterError",
  "PrismaClientInitializationError",
  "PrismaClientKnownRequestError",
  "PrismaClientRustPanicError",
  "PrismaClientUnknownRequestError",
  "TokenExpiredError",
  "ZodError",
]);

export const getSafeErrorMetadata = (error: unknown): SafeErrorMetadata => {
  if (!(error instanceof Error)) {
    return Object.freeze({ errorType: "UnknownError" });
  }

  if (error instanceof ApplicationError) {
    return Object.freeze({
      errorType: error.name === "CustomError" ? "CustomError" : "ApplicationError",
      applicationCode: error.code,
    });
  }

  return Object.freeze({
    errorType: SAFE_ERROR_TYPES.has(error.name) ? error.name : "Error",
  });
};

export const logSafeError = (
  logger: LoggerPort,
  event: LogEventName,
  error: unknown,
  fields?: Omit<LogEventFields, "errorType" | "applicationCode">,
): void => {
  try {
    logger.error(event, {
      ...fields,
      ...getSafeErrorMetadata(error),
    });
  } catch {
    // Logging must never change the protected operation's behavior.
  }
};
