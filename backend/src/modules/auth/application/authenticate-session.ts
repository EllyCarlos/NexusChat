import { ApplicationError } from "../../../errors/application-error.js";
import type { AuthIdentityRepository } from "../contracts/auth-identity.repository.js";
import type { AuthenticatedIdentity } from "../contracts/auth-identity.js";
import {
  classifySessionTokenError,
  type SessionTokenBoundary,
  type SessionTokenPayload,
} from "../token/session-token.service.js";

export type SessionAuthenticationFailure =
  | "token_expired"
  | "token_invalid"
  | "token_verification_failed"
  | "identity_not_found"
  | "repository_failure";

export class SessionAuthenticationError extends ApplicationError {
  readonly reason: SessionAuthenticationFailure;

  constructor(reason: SessionAuthenticationFailure) {
    super({
      code: `SESSION_AUTH_${reason.toUpperCase()}`,
      message: reason === "repository_failure"
        ? "Internal server error"
        : "Session authentication failed.",
      statusCode: reason === "repository_failure" ? 500 : 401,
    });
    this.name = "SessionAuthenticationError";
    this.reason = reason;
  }
}

type SessionVerifier = (
  token: string,
  boundary: SessionTokenBoundary,
) => SessionTokenPayload;

type AuthenticateSessionDependencies = {
  identityRepository: Pick<AuthIdentityRepository, "findSessionIdentityById">;
  verifyToken: SessionVerifier;
};

export const createSessionAuthenticator = ({
  identityRepository,
  verifyToken,
}: AuthenticateSessionDependencies) => async ({
  token,
  boundary,
}: {
  token: string;
  boundary: SessionTokenBoundary;
}): Promise<AuthenticatedIdentity> => {
  let payload: SessionTokenPayload;
  try {
    payload = verifyToken(token, boundary);
  } catch (error) {
    const tokenErrorKind = classifySessionTokenError(error);
    throw new SessionAuthenticationError(
      tokenErrorKind === "expired"
        ? "token_expired"
        : tokenErrorKind === "invalid"
          ? "token_invalid"
          : "token_verification_failed",
    );
  }

  let identity: AuthenticatedIdentity | null;
  try {
    identity = await identityRepository.findSessionIdentityById(payload.userId);
  } catch {
    throw new SessionAuthenticationError("repository_failure");
  }

  if (!identity) {
    throw new SessionAuthenticationError("identity_not_found");
  }

  return identity;
};

export const isSessionAuthenticationError = (
  error: unknown,
): error is SessionAuthenticationError => error instanceof SessionAuthenticationError;
