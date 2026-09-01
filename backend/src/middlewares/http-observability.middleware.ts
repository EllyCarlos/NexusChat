import { performance } from "node:perf_hooks";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import type {
  LogEventFields,
  LogHttpMethod,
  LogOperationResult,
} from "../observability/log-event.types.js";
import type { LoggerPort } from "../observability/logger.port.js";
import { createRequestContextLogger } from "../observability/request-context-logger.js";
import { runWithRequestContext } from "../observability/request-context.js";
import {
  REQUEST_ID_HEADER,
  selectRequestId,
} from "../observability/request-id.js";

const requestRouteBases = new WeakMap<Request, string>();
const SAFE_ROUTE_TEMPLATE = /^\/[A-Za-z0-9_/:.*-]*$/;
const KNOWN_HTTP_METHODS = new Set<LogHttpMethod>([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);

type HttpObservabilityOptions = {
  readonly logger: LoggerPort;
  readonly clock?: () => number;
  readonly generateRequestId?: () => string;
};

const isSafeRouteTemplate = (value: unknown): value is string =>
  typeof value === "string"
  && value.length > 0
  && value.length <= 256
  && SAFE_ROUTE_TEMPLATE.test(value);

const combineRouteTemplate = (base: string, route: string): string | undefined => {
  if (!isSafeRouteTemplate(base) || !isSafeRouteTemplate(route)) return undefined;
  if (!base || base === "/") return route;
  if (route === "/") return base;
  return `${base.replace(/\/$/, "")}/${route.replace(/^\//, "")}`;
};

export const getNormalizedRequestRoute = (request: Request): string => {
  const routePath = request.route?.path as unknown;
  if (typeof routePath === "string") {
    const base = requestRouteBases.get(request) ?? "";
    return combineRouteTemplate(base || "/", routePath) ?? "unknown";
  }
  return request.res?.statusCode === 404 ? "unmatched" : "pre_route";
};

export const createRouteTemplateBaseMiddleware = (base: string): RequestHandler => {
  if (!isSafeRouteTemplate(base)) {
    throw new TypeError("Route template base must be a bounded static path.");
  }
  return (request, _response, next) => {
    requestRouteBases.set(request, base);
    next();
  };
};

const normalizeMethod = (method: string): LogHttpMethod => {
  const normalized = method.toUpperCase() as LogHttpMethod;
  return KNOWN_HTTP_METHODS.has(normalized) ? normalized : "OTHER";
};

const classifyStatus = (statusCode: number): LogOperationResult => {
  if (statusCode >= 500) return "server_error";
  if (statusCode >= 400) return "client_error";
  if (statusCode >= 300) return "redirect";
  return "success";
};

const readResponseSize = (response: Response): number | undefined => {
  const contentLength = response.getHeader("content-length");
  if (typeof contentLength === "number") {
    return Number.isSafeInteger(contentLength) && contentLength >= 0
      ? contentLength
      : undefined;
  }
  if (typeof contentLength !== "string" || !/^\d+$/.test(contentLength)) {
    return undefined;
  }
  const parsed = Number(contentLength);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const durationSince = (startedAt: number, clock: () => number): number => {
  const elapsed = clock() - startedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
  return Math.round(elapsed * 1_000) / 1_000;
};

export const createHttpObservabilityMiddleware = ({
  logger,
  clock = () => performance.now(),
  generateRequestId,
}: HttpObservabilityOptions): RequestHandler => {
  const httpLogger = createRequestContextLogger(logger.forComponent("http"));

  return (request: Request, response: Response, next: NextFunction) => {
    const requestId = selectRequestId(
      request.get(REQUEST_ID_HEADER),
      generateRequestId,
    );
    const startedAt = clock();
    response.setHeader(REQUEST_ID_HEADER, requestId);

    runWithRequestContext({ requestId }, () => {
      let logged = false;
      const logCompletion = (result?: LogOperationResult): void => {
        if (logged) return;
        logged = true;
        const route = getNormalizedRequestRoute(request);
        if (route === "/health" && response.statusCode < 500) return;

        const fields: LogEventFields = {
          requestId,
          method: normalizeMethod(request.method),
          route,
          statusCode: response.statusCode,
          result: result ?? classifyStatus(response.statusCode),
          durationMs: durationSince(startedAt, clock),
          ...(() => {
            const responseSizeBytes = readResponseSize(response);
            return responseSizeBytes === undefined ? {} : { responseSizeBytes };
          })(),
        };
        try {
          httpLogger.info("http.request.completed", fields);
        } catch {
          // Request completion must not depend on observability health.
        }
      };

      response.once("finish", () => logCompletion());
      response.once("close", () => {
        if (!response.writableFinished) logCompletion("aborted");
      });
      next();
    });
  };
};
