type SafeErrorMetadata = {
  errorType: string;
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
