import type { NextFunction, RequestHandler, Response } from "express";
import type { AuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import {
  consumeBackendRateLimit,
  consumeLayeredBackendRateLimit,
  RATE_LIMIT_MESSAGE,
  type RateLimitPolicy,
} from "../security/rate-limit.js";
import { CustomError } from "../utils/error.utils.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export const BACKEND_RATE_LIMITS = {
  fcmToken: { namespace: "api-fcm-token", limit: 20, windowMs: HOUR_MS },
  testEmailCooldown: { namespace: "test-email-cooldown", limit: 1, windowMs: MINUTE_MS },
  testEmailWindow: { namespace: "test-email-window", limit: 3, windowMs: HOUR_MS },
  avatarUpload: { namespace: "avatar-upload", limit: 10, windowMs: HOUR_MS },
  attachmentUpload: { namespace: "attachment-upload", limit: 60, windowMs: 10 * MINUTE_MS },
  friendCreateCooldown: { namespace: "friend-create-cooldown", limit: 1, windowMs: 30 * 1000 },
  friendCreateWindow: { namespace: "friend-create-window", limit: 10, windowMs: HOUR_MS },
  friendHandle: { namespace: "friend-handle", limit: 10, windowMs: 5 * MINUTE_MS },
} satisfies Record<string, RateLimitPolicy>;

const rejectLimitedRequest = (response: Response, next: NextFunction, retryAfterSeconds: number) => {
  response.setHeader("Retry-After", String(retryAfterSeconds));
  next(new CustomError(RATE_LIMIT_MESSAGE, 429));
};

export const createAuthenticatedUserRateLimit = (
  policy: RateLimitPolicy,
  secondPolicy?: RateLimitPolicy,
): RequestHandler => (request, response, next) => {
  const userId = (request as AuthenticatedRequest).user?.id;
  if (!userId) {
    next(new CustomError("Authentication is required", 401));
    return;
  }

  const decision = secondPolicy
    ? consumeLayeredBackendRateLimit(userId, policy, secondPolicy)
    : consumeBackendRateLimit(policy, userId);
  if (!decision.allowed) {
    rejectLimitedRequest(response, next, decision.retryAfterSeconds);
    return;
  }
  next();
};

export const fcmTokenRateLimit = createAuthenticatedUserRateLimit(BACKEND_RATE_LIMITS.fcmToken);
export const testEmailRateLimit = createAuthenticatedUserRateLimit(
  BACKEND_RATE_LIMITS.testEmailCooldown,
  BACKEND_RATE_LIMITS.testEmailWindow,
);
const authenticatedAvatarUploadRateLimit = createAuthenticatedUserRateLimit(
  BACKEND_RATE_LIMITS.avatarUpload,
);
export const avatarUploadRateLimit: RequestHandler = (request, response, next) => {
  if (!request.is("multipart/form-data")) {
    next();
    return;
  }
  authenticatedAvatarUploadRateLimit(request, response, next);
};
export const attachmentUploadRateLimit = createAuthenticatedUserRateLimit(BACKEND_RATE_LIMITS.attachmentUpload);

export const enforcePairRateLimit = ({
  response,
  next,
  actorUserId,
  otherUserId,
  policy,
  secondPolicy,
}: {
  response: Response;
  next: NextFunction;
  actorUserId: string;
  otherUserId: string;
  policy: RateLimitPolicy;
  secondPolicy?: RateLimitPolicy;
}): boolean => {
  const pairKey = [actorUserId, otherUserId].sort().join(":");
  const decision = secondPolicy
    ? consumeLayeredBackendRateLimit(pairKey, policy, secondPolicy)
    : consumeBackendRateLimit(policy, pairKey);
  if (decision.allowed) return true;

  rejectLimitedRequest(response, next, decision.retryAfterSeconds);
  return false;
};
