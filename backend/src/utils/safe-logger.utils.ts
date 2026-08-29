import { ApplicationError } from "../errors/application-error.js";

type SafeErrorMetadata = {
  errorType: string;
  applicationCode?: string;
};

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
    return { errorType: "UnknownError" };
  }

  if (error instanceof ApplicationError) {
    return {
      errorType: error.name === "CustomError" ? "CustomError" : "ApplicationError",
      applicationCode: error.code,
    };
  }

  return {
    errorType: SAFE_ERROR_TYPES.has(error.name) ? error.name : "Error",
  };
};

export const logServerError = (context: string, error?: unknown): void => {
  if (error === undefined) {
    console.error(context);
    return;
  }

  console.error(context, getSafeErrorMetadata(error));
};
