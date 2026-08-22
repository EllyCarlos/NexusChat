import "server-only";

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";

export const TOKEN_TYPES = {
  SESSION: "session",
  PASSWORD_RESET: "password_reset",
  PRIVATE_KEY_RECOVERY: "private_key_recovery",
  OAUTH_EXCHANGE: "oauth_exchange",
} as const;

type TokenType = (typeof TOKEN_TYPES)[keyof typeof TOKEN_TYPES];

type BaseTokenPayload<T extends TokenType> = {
  tokenType: T;
  userId: string;
  exp: number;
  iat?: number;
};

type ExpiringLinkTokenPayload<T extends TokenType> = BaseTokenPayload<T> & {
  expiresAt: string;
};

export type SessionPayload = ExpiringLinkTokenPayload<typeof TOKEN_TYPES.SESSION>;
export type PasswordResetTokenPayload = ExpiringLinkTokenPayload<typeof TOKEN_TYPES.PASSWORD_RESET>;
export type PrivateKeyRecoveryTokenPayload = ExpiringLinkTokenPayload<typeof TOKEN_TYPES.PRIVATE_KEY_RECOVERY>;
export type OAuthExchangeTokenPayload = BaseTokenPayload<typeof TOKEN_TYPES.OAUTH_EXCHANGE> & {
  isNewUser: boolean;
  email?: string;
};

type TokenInput = {
  userId: string;
  expiresAt: Date;
};

type VerifiedPurposeTokenPayload = JWTPayload & {
  tokenType: TokenType;
  userId: string;
  exp: number;
};

const getEncodedJwtSecret = () => {
  const secretKey = process.env.JWT_SECRET;
  if (!secretKey) {
    throw new Error("JWT_SECRET environment variable is not defined! Please set it securely.");
  }
  return new TextEncoder().encode(secretKey);
};

const validateTokenInput = ({ userId, expiresAt }: TokenInput) => {
  if (!userId) {
    throw new Error("Token userId is required.");
  }

  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error("Token expiry is invalid.");
  }
};

const signPurposeToken = async ({
  tokenType,
  userId,
  expiresAt,
  additionalClaims = {},
}: TokenInput & {
  tokenType: TokenType;
  additionalClaims?: Record<string, unknown>;
}): Promise<string> => {
  validateTokenInput({ userId, expiresAt });

  return new SignJWT({
    ...additionalClaims,
    userId,
    expiresAt: expiresAt.toISOString(),
    tokenType,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(getEncodedJwtSecret());
};

const verifyPurposeToken = async (
  token: string | undefined,
  expectedTokenType: TokenType,
): Promise<VerifiedPurposeTokenPayload | null> => {
  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getEncodedJwtSecret(), {
      algorithms: ["HS256"],
    });

    if (
      payload.tokenType !== expectedTokenType ||
      typeof payload.userId !== "string" ||
      payload.userId.length === 0 ||
      typeof payload.exp !== "number" ||
      !Number.isFinite(payload.exp) ||
      payload.exp * 1000 <= Date.now()
    ) {
      return null;
    }

    return {
      ...payload,
      tokenType: expectedTokenType,
      userId: payload.userId,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
};

const getLinkTokenPayload = <T extends TokenType>(
  payload: VerifiedPurposeTokenPayload | null,
  tokenType: T,
): ExpiringLinkTokenPayload<T> | null => {
  if (!payload || typeof payload.expiresAt !== "string") {
    return null;
  }

  const expiresAt = new Date(payload.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return {
    tokenType,
    userId: payload.userId,
    expiresAt: payload.expiresAt,
    exp: payload.exp,
    ...(typeof payload.iat === "number" ? { iat: payload.iat } : {}),
  };
};

export const signSessionToken = (input: TokenInput) =>
  signPurposeToken({ ...input, tokenType: TOKEN_TYPES.SESSION });

export const signPasswordResetToken = (input: TokenInput) =>
  signPurposeToken({ ...input, tokenType: TOKEN_TYPES.PASSWORD_RESET });

export const signPrivateKeyRecoveryToken = (input: TokenInput) =>
  signPurposeToken({ ...input, tokenType: TOKEN_TYPES.PRIVATE_KEY_RECOVERY });

export const verifySessionToken = async (token: string | undefined): Promise<SessionPayload | null> =>
  getLinkTokenPayload(
    await verifyPurposeToken(token, TOKEN_TYPES.SESSION),
    TOKEN_TYPES.SESSION,
  );

export const verifyPasswordResetToken = async (
  token: string | undefined,
): Promise<PasswordResetTokenPayload | null> =>
  getLinkTokenPayload(
    await verifyPurposeToken(token, TOKEN_TYPES.PASSWORD_RESET),
    TOKEN_TYPES.PASSWORD_RESET,
  );

export const verifyPrivateKeyRecoveryToken = async (
  token: string | undefined,
): Promise<PrivateKeyRecoveryTokenPayload | null> =>
  getLinkTokenPayload(
    await verifyPurposeToken(token, TOKEN_TYPES.PRIVATE_KEY_RECOVERY),
    TOKEN_TYPES.PRIVATE_KEY_RECOVERY,
  );

export const verifyOAuthExchangeToken = async (
  token: string | undefined,
): Promise<OAuthExchangeTokenPayload | null> => {
  const payload = await verifyPurposeToken(token, TOKEN_TYPES.OAUTH_EXCHANGE);
  if (!payload || typeof payload.isNewUser !== "boolean") {
    return null;
  }

  if (payload.email !== undefined && typeof payload.email !== "string") {
    return null;
  }

  return {
    tokenType: TOKEN_TYPES.OAUTH_EXCHANGE,
    userId: payload.userId,
    isNewUser: payload.isNewUser,
    exp: payload.exp,
    ...(typeof payload.iat === "number" ? { iat: payload.iat } : {}),
    ...(typeof payload.email === "string" ? { email: payload.email } : {}),
  };
};

/**
 * Creates a 30-day session, persists it in the existing cookies, and returns
 * the same JWT for callers that must populate the current bearer-token state.
 */
export async function createSession(userId: string): Promise<string> {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const sessionToken = await signSessionToken({ userId, expiresAt });
  const cookieStore = await cookies();

  cookieStore.set("loggedInUserId", userId, {
    expires: expiresAt,
    secure: process.env.NODE_ENV === "production",
    sameSite: "none",
    path: "/",
  });

  cookieStore.set("session", sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    sameSite: "none",
    path: "/",
  });

  return sessionToken;
}

export async function deleteSession() {
  (await cookies()).delete("session");
  (await cookies()).delete("loggedInUserId");
}

export async function verifySession(sessionToken: string | undefined): Promise<string | null> {
  const payload = await verifySessionToken(sessionToken);
  return payload?.userId ?? null;
}
