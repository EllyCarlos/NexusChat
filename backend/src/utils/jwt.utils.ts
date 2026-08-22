import jwt, { type JwtPayload } from "jsonwebtoken";

export const TOKEN_TYPES = {
  SESSION: "session",
  PASSWORD_RESET: "password_reset",
  PRIVATE_KEY_RECOVERY: "private_key_recovery",
  OAUTH_EXCHANGE: "oauth_exchange",
} as const;

type TokenType = (typeof TOKEN_TYPES)[keyof typeof TOKEN_TYPES];

export type SessionTokenPayload = {
  tokenType: typeof TOKEN_TYPES.SESSION;
  userId: string;
  expiresAt: string;
  exp: number;
  iat?: number;
};

type PurposeTokenInput = {
  userId: string;
  expiresAt: Date;
};

type OAuthExchangeTokenInput = {
  userId: string;
  isNewUser: boolean;
  email: string;
};

const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not defined.");
  }
  return secret;
};

const validatePurposeTokenInput = ({ userId, expiresAt }: PurposeTokenInput) => {
  if (!userId) {
    throw new Error("Token userId is required.");
  }

  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error("Token expiry is invalid.");
  }

  const expiresInSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  if (expiresInSeconds <= 0) {
    throw new Error("Token expiry must be in the future.");
  }

  return expiresInSeconds;
};

const signPurposeToken = ({
  tokenType,
  userId,
  expiresAt,
  additionalClaims = {},
}: PurposeTokenInput & {
  tokenType: TokenType;
  additionalClaims?: Record<string, unknown>;
}): string => {
  const expiresIn = validatePurposeTokenInput({ userId, expiresAt });

  return jwt.sign(
    {
      ...additionalClaims,
      userId,
      expiresAt: expiresAt.toISOString(),
      tokenType,
    },
    getJwtSecret(),
    { algorithm: "HS256", expiresIn },
  );
};

export const signPasswordResetToken = (input: PurposeTokenInput): string =>
  signPurposeToken({ ...input, tokenType: TOKEN_TYPES.PASSWORD_RESET });

export const signOAuthExchangeToken = ({
  userId,
  isNewUser,
  email,
}: OAuthExchangeTokenInput): string => {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  return signPurposeToken({
    tokenType: TOKEN_TYPES.OAUTH_EXCHANGE,
    userId,
    expiresAt,
    additionalClaims: { isNewUser, email },
  });
};

const isJwtPayload = (payload: string | JwtPayload): payload is JwtPayload =>
  typeof payload === "object" && payload !== null;

export const verifySessionToken = (token: string): SessionTokenPayload => {
  const payload = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] });

  if (
    !isJwtPayload(payload) ||
    payload.tokenType !== TOKEN_TYPES.SESSION ||
    typeof payload.userId !== "string" ||
    payload.userId.length === 0 ||
    typeof payload.expiresAt !== "string" ||
    Number.isNaN(new Date(payload.expiresAt).getTime()) ||
    new Date(payload.expiresAt).getTime() <= Date.now() ||
    typeof payload.exp !== "number" ||
    !Number.isFinite(payload.exp) ||
    payload.exp * 1000 <= Date.now()
  ) {
    throw new jwt.JsonWebTokenError("Invalid session token payload.");
  }

  return {
    tokenType: TOKEN_TYPES.SESSION,
    userId: payload.userId,
    expiresAt: payload.expiresAt,
    exp: payload.exp,
    ...(typeof payload.iat === "number" ? { iat: payload.iat } : {}),
  };
};
