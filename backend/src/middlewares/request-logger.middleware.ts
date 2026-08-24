import type { Request, Response } from "express";
import morgan from "morgan";

export const SANITIZED_MORGAN_FORMAT =
  ":method :sanitized-url :status :res[content-length] - :response-time ms";

export const getSanitizedRequestPath = (req: Pick<Request, "originalUrl" | "url">) => {
  const requestUrl = req.originalUrl || req.url || "/";

  try {
    return new URL(requestUrl, "http://localhost").pathname;
  } catch {
    return requestUrl.split("?")[0]?.split("#")[0] || "/";
  }
};

morgan.token<Request, Response>("sanitized-url", (req) =>
  getSanitizedRequestPath(req),
);

export const createRequestLogger = (
  options?: morgan.Options<Request, Response>,
) => morgan<Request, Response>(SANITIZED_MORGAN_FORMAT, options);
