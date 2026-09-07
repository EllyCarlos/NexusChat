import { timingSafeEqual } from "node:crypto";
import type { RequestHandler, Response } from "express";

import type { MetricsPort } from "../observability/metrics.port.js";

const METRICS_EXCLUSION_LOCAL = "nexuschatExcludeHttpMetrics";
const BEARER_CREDENTIAL_PATTERN = /^Bearer ([A-Za-z0-9._~+/-]+={0,2})$/;

export const markMetricsRequest: RequestHandler = (_request, response, next) => {
  response.locals[METRICS_EXCLUSION_LOCAL] = true;
  next();
};

export const isMetricsRequest = (response: Response): boolean =>
  response.locals?.[METRICS_EXCLUSION_LOCAL] === true;

export const credentialsMatch = (provided: string, expected: string): boolean => {
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
};

const readBearerCredential = (authorization: string | undefined): string | undefined =>
  authorization?.match(BEARER_CREDENTIAL_PATTERN)?.[1];

export const createMetricsEndpointHandler = ({
  metrics,
  bearerToken,
}: {
  readonly metrics: MetricsPort;
  readonly bearerToken: string;
}): RequestHandler => async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  const providedCredential = readBearerCredential(request.get("authorization"));
  if (
    providedCredential === undefined
    || !credentialsMatch(providedCredential, bearerToken)
  ) {
    response.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  try {
    const exposition = await metrics.render();
    response.setHeader("Content-Type", exposition.contentType);
    response.status(200).end(exposition.body);
  } catch {
    response.status(503).json({ success: false, message: "Metrics unavailable" });
  }
};
