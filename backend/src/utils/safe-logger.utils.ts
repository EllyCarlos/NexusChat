import { getSafeErrorMetadata } from "../observability/safe-error.js";

export { getSafeErrorMetadata } from "../observability/safe-error.js";

export const logServerError = (context: string, error?: unknown): void => {
  if (error === undefined) {
    console.error(context);
    return;
  }

  console.error(context, getSafeErrorMetadata(error));
};
