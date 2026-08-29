import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import { isSessionAuthenticationError } from "../modules/auth/application/authenticate-session.js";
import { authenticateSession } from "../modules/auth/session-auth.service.js";
import type { AuthenticatedIdentity } from "../modules/auth/contracts/auth-identity.js";
import { CustomError, asyncErrorHandler } from "../utils/error.utils.js";
import { logServerError } from "../utils/safe-logger.utils.js";

type AuthenticateSessionOperation = (input: {
  token: string;
  boundary: "api";
}) => Promise<AuthenticatedIdentity>;

export const extractRestSessionToken = (
  request: AuthenticatedRequest,
): string | undefined => {
  if (request.cookies?.session) {
    return request.cookies.session as string;
  }

  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    return authorization.split(" ")[1];
  }

  return undefined;
};

export const createVerifyTokenMiddleware = (
  authenticate: AuthenticateSessionOperation = authenticateSession,
) => asyncErrorHandler(async (
  request: AuthenticatedRequest,
  _response: Response,
  next: NextFunction,
) => {
  const token = extractRestSessionToken(request);
  if (!token) {
    console.warn("Authentication: No token found in cookies or Authorization header.");
    return next(new CustomError("Token missing, please login again", 401));
  }

  try {
    request.user = await authenticate({ token, boundary: "api" });
    next();
  } catch (error) {
    if (!isSessionAuthenticationError(error)) {
      throw error;
    }

    if (error.reason === "identity_not_found") {
      console.warn("Authentication: Token subject was not found.");
      return next(new CustomError("Invalid or expired token", 401));
    }

    if (error.reason === "repository_failure") {
      return next(error);
    }

    logServerError("Session token verification failed.", error);
    return next(new CustomError("Invalid or expired token", 401));
  }
});

export const verifyToken = createVerifyTokenMiddleware();
