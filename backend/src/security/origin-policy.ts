import type { IncomingMessage } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { CustomError } from "../utils/error.utils.js";

export const DEVELOPMENT_FRONTEND_ORIGIN = "http://localhost:3000";
export const PRODUCTION_FRONTEND_ORIGIN = "https://nexuswebapp.vercel.app";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const VERCEL_DEPLOYMENT_HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+vercel\.app$/i;

type OriginPolicyOptions = {
  environment: string;
  frontendOrigin: string;
  vercelUrl?: string;
  onInvalidConfiguredOrigin?: () => void;
};

export type OriginPolicy = {
  origins: readonly string[];
  allows: (origin: string | undefined) => boolean;
};

type OriginDecisionCallback = (error: Error | null, allow?: boolean) => void;
type SocketAdmissionCallback = (error: string | null, success: boolean) => void;

export const normalizeHttpOrigin = (value: string): string | undefined => {
  const candidate = value.trim();
  if (!candidate) return undefined;

  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
};

export const normalizeVercelUrl = (value: string): string | undefined => {
  const candidate = value.trim();
  if (!candidate) return undefined;

  const withScheme = candidate.includes("://") ? candidate : `https://${candidate}`;
  const normalized = normalizeHttpOrigin(withScheme);
  if (!normalized) return undefined;

  const url = new URL(normalized);
  if (url.protocol !== "https:" || !VERCEL_DEPLOYMENT_HOSTNAME.test(url.hostname) || url.port) {
    return undefined;
  }

  return normalized;
};

export const createOriginPolicy = ({
  environment,
  frontendOrigin,
  vercelUrl,
  onInvalidConfiguredOrigin = () => console.warn("Configured browser origin was ignored."),
}: OriginPolicyOptions): OriginPolicy => {
  const origins = new Set<string>();
  const addConfiguredOrigin = (value: string | undefined, normalize = normalizeHttpOrigin) => {
    if (value === undefined) return;
    const normalized = normalize(value);
    if (!normalized) {
      onInvalidConfiguredOrigin();
      return;
    }
    origins.add(normalized);
  };

  addConfiguredOrigin(frontendOrigin);
  if (environment === "development") {
    addConfiguredOrigin(DEVELOPMENT_FRONTEND_ORIGIN);
  }
  if (environment === "production") {
    addConfiguredOrigin(vercelUrl, normalizeVercelUrl);
  }

  const canonicalOrigins = Object.freeze([...origins]);
  return {
    origins: canonicalOrigins,
    allows: (origin) => {
      if (origin === undefined) return true;
      const normalized = normalizeHttpOrigin(origin);
      return normalized !== undefined && origins.has(normalized);
    },
  };
};

export const createCorsOriginDelegate = (policy: OriginPolicy) => (
  origin: string | undefined,
  callback: OriginDecisionCallback,
) => {
  if (policy.allows(origin)) {
    callback(null, true);
    return;
  }

  callback(new CustomError("Origin not allowed", 403));
};

export const createSocketAllowRequest = (policy: OriginPolicy) => (
  request: IncomingMessage,
  callback: SocketAdmissionCallback,
) => {
  const origin = typeof request.headers.origin === "string"
    ? request.headers.origin
    : undefined;
  callback(null, policy.allows(origin));
};

const hasBearerAuthorization = (request: Request): boolean => {
  const authorization = request.get("authorization");
  return typeof authorization === "string" && /^Bearer\s+\S+$/.test(authorization);
};

const hasSessionCookie = (request: Request): boolean => {
  const cookieHeader = request.get("cookie");
  if (!cookieHeader) return false;

  return cookieHeader.split(";").some((cookie) => {
    const [name, ...valueParts] = cookie.trim().split("=");
    return name === "session" && valueParts.join("=").length > 0;
  });
};

export const createMutationOriginMiddleware = (policy: OriginPolicy) => (
  request: Request,
  _response: Response,
  next: NextFunction,
) => {
  if (!MUTATION_METHODS.has(request.method.toUpperCase())) {
    next();
    return;
  }

  const origin = request.get("origin");
  if (origin !== undefined) {
    if (!policy.allows(origin)) {
      next(new CustomError("Origin not allowed", 403));
      return;
    }
    next();
    return;
  }

  if (hasSessionCookie(request) && !hasBearerAuthorization(request)) {
    next(new CustomError("Origin not allowed", 403));
    return;
  }

  next();
};
