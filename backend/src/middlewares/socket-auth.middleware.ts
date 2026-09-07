import type { NextFunction } from "connect";
import type { Socket } from "socket.io";
import { CustomError } from "../utils/error.utils.js";
import { isSessionAuthenticationError } from "../modules/auth/application/authenticate-session.js";
import { authenticateSession } from "../modules/auth/session-auth.service.js";
import type { AuthenticatedIdentity } from "../modules/auth/contracts/auth-identity.js";
import type { LoggerPort } from "../observability/logger.port.js";
import type { MetricsPort } from "../observability/metrics.port.js";
import { noopLogger } from "../observability/noop-logger.js";
import { noopMetrics } from "../observability/noop-metrics.js";
import { recordSocketConnectionAdmission } from "../observability/realtime-metrics.js";
import { logSafeError } from "../observability/safe-error.js";

export const MAX_SOCKET_TOKEN_LENGTH = 4_096;

export const hasPlausibleJwtShape = (token: unknown): token is string =>
  typeof token === "string"
  && token.length > 0
  && token.length <= MAX_SOCKET_TOKEN_LENGTH
  && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);

type AuthenticateSessionOperation = (input: {
  token: string;
  boundary: "socket";
}) => Promise<AuthenticatedIdentity>;

export const createSocketAuthenticatorMiddleware = (
  authenticate: AuthenticateSessionOperation = authenticateSession,
  logger: LoggerPort = noopLogger.forComponent("auth"),
  metrics: MetricsPort = noopMetrics,
) => async (socket: Socket, next: NextFunction) => {
  const rejectAuthentication = (message: string) => {
    recordSocketConnectionAdmission(metrics, {
      result: "rejected",
      reason: "authentication",
    });
    return next(new CustomError(message, 401));
  };
  const token = socket.handshake.query.token;
  if (token === undefined) {
    return rejectAuthentication("Token missing, please login again");
  }
  if (!hasPlausibleJwtShape(token)) {
    return rejectAuthentication("Invalid token format");
  }

  try {
    const identity = await authenticate({ token, boundary: "socket" });
    socket.user = {
      id: identity.id,
      username: identity.username,
      avatar: identity.avatar,
    };
    next();
  } catch (error) {
    if (isSessionAuthenticationError(error)) {
      if (error.reason === "token_expired") {
        return rejectAuthentication("Token expired, please login again");
      }
      if (error.reason === "token_invalid") {
        return rejectAuthentication("Invalid token format");
      }
      if (error.reason === "identity_not_found") {
        return rejectAuthentication("Invalid Token, please login again");
      }
    }

    logSafeError(logger, "auth.socket_authentication.failed", error);
    return rejectAuthentication("Invalid Token, please login again");
  }
};

export const socketAuthenticatorMiddleware = createSocketAuthenticatorMiddleware();
