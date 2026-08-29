import type { NextFunction, Response } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env.config.js", () => ({
  config: { auth: { jwtSecret: "phase-1c-1a-test-secret" } },
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import type { AuthenticatedRequest } from "../src/interfaces/auth/auth.interface.js";
import {
  SESSION_TOKEN_AUDIENCES,
  TOKEN_AUDIENCES,
  TOKEN_ISSUERS,
} from "../src/constants/token.constants.js";
import { prisma } from "../src/lib/prisma.lib.js";
import { socketAuthenticatorMiddleware } from "../src/middlewares/socket-auth.middleware.js";
import { verifyToken } from "../src/middlewares/verify-token.middleware.js";
import {
  signOAuthExchangeToken,
  signPasswordResetToken,
  TOKEN_TYPES,
  verifyApiSessionToken,
  verifySocketSessionToken,
} from "../src/modules/auth/token/session-token.service.js";

const JWT_SECRET = "phase-1c-1a-test-secret";
const USER_ID = "token-purpose-user";
const futureExpiry = () => new Date(Date.now() + 60 * 60 * 1000);
const SESSION_USER = {
  id: USER_ID,
  name: "Session User",
  username: "session-user",
  avatar: "https://example.test/avatar.png",
  email: "session-user@example.test",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  emailVerified: true,
  publicKey: "public-key",
  needsKeyRecovery: false,
  keyRecoveryCompletedAt: null,
  notificationsEnabled: true,
  verificationBadge: false,
  fcmToken: null,
  oAuthSignup: false,
};

const signRawToken = (
  tokenType?: string,
  {
    issuer = TOKEN_ISSUERS.WEB,
    audience = [...SESSION_TOKEN_AUDIENCES],
    includeIssuer = true,
    includeAudience = true,
  }: {
    issuer?: string;
    audience?: string | string[];
    includeIssuer?: boolean;
    includeAudience?: boolean;
  } = {},
) => {
  const options: SignOptions = { algorithm: "HS256", expiresIn: "1h" };
  if (includeIssuer) {
    options.issuer = issuer;
  }
  if (includeAudience) {
    options.audience = audience;
  }

  return jwt.sign(
    {
      ...(tokenType ? { tokenType } : {}),
      userId: USER_ID,
      expiresAt: futureExpiry().toISOString(),
      ...(tokenType === TOKEN_TYPES.OAUTH_EXCHANGE ? { isNewUser: false } : {}),
    },
    JWT_SECRET,
    options,
  );
};

const getRejectedAuthError = (
  next: ReturnType<typeof vi.fn>,
  message: string,
) => {
  expect(next).toHaveBeenCalledTimes(1);
  const error = next.mock.calls[0]?.[0];
  expect(error).toMatchObject({ statusCode: 401, message });
};

const signExpiredSessionToken = () => jwt.sign(
  {
    tokenType: TOKEN_TYPES.SESSION,
    userId: USER_ID,
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  },
  JWT_SECRET,
  {
    algorithm: "HS256",
    expiresIn: -1,
    issuer: TOKEN_ISSUERS.WEB,
    audience: [...SESSION_TOKEN_AUDIENCES],
  },
);

const signCustomSessionToken = ({
  algorithm = "HS256",
  audience = [...SESSION_TOKEN_AUDIENCES] as string[],
  expiresAt = futureExpiry().toISOString(),
  expiresIn = "1h" as SignOptions["expiresIn"],
  includeExp = true,
  includeExpiresAt = true,
  includeUserId = true,
  signingSecret = JWT_SECRET,
  userId = USER_ID,
}: {
  algorithm?: SignOptions["algorithm"];
  audience?: string[];
  expiresAt?: string;
  expiresIn?: SignOptions["expiresIn"];
  includeExp?: boolean;
  includeExpiresAt?: boolean;
  includeUserId?: boolean;
  signingSecret?: string;
  userId?: string;
} = {}) => jwt.sign(
  {
    tokenType: TOKEN_TYPES.SESSION,
    ...(includeUserId ? { userId } : {}),
    ...(includeExpiresAt ? { expiresAt } : {}),
  },
  signingSecret,
  {
    algorithm,
    ...(includeExp ? { expiresIn } : {}),
    issuer: TOKEN_ISSUERS.WEB,
    audience,
  },
);

describe("backend token-purpose enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a valid session token in the shared session verifier", () => {
    const sessionToken = signRawToken(TOKEN_TYPES.SESSION);

    expect(verifyApiSessionToken(sessionToken)).toMatchObject({
      tokenType: TOKEN_TYPES.SESSION,
      userId: USER_ID,
      iss: TOKEN_ISSUERS.WEB,
      aud: [...SESSION_TOKEN_AUDIENCES],
    });
    expect(verifySocketSessionToken(sessionToken)).toMatchObject({
      tokenType: TOKEN_TYPES.SESSION,
      userId: USER_ID,
    });
  });

  it.each([
    TOKEN_TYPES.PASSWORD_RESET,
    TOKEN_TYPES.PRIVATE_KEY_RECOVERY,
    TOKEN_TYPES.OAUTH_EXCHANGE,
    undefined,
  ])("rejects %s tokens in the shared session verifier", (tokenType) => {
    expect(() => verifyApiSessionToken(signRawToken(tokenType))).toThrow();
  });

  it("purpose-specific signers cannot be overridden by caller input", () => {
    const passwordResetToken = signPasswordResetToken({
      userId: USER_ID,
      expiresAt: futureExpiry(),
      tokenType: TOKEN_TYPES.SESSION,
      issuer: TOKEN_ISSUERS.API,
      audience: TOKEN_AUDIENCES.SOCKET,
    } as Parameters<typeof signPasswordResetToken>[0]);
    const oauthExchangeToken = signOAuthExchangeToken({
      userId: USER_ID,
      isNewUser: false,
      email: "user@example.com",
      tokenType: TOKEN_TYPES.SESSION,
      issuer: TOKEN_ISSUERS.WEB,
      audience: TOKEN_AUDIENCES.API,
    } as Parameters<typeof signOAuthExchangeToken>[0]);

    expect(jwt.verify(passwordResetToken, JWT_SECRET, { algorithms: ["HS256"] })).toMatchObject({
      tokenType: TOKEN_TYPES.PASSWORD_RESET,
      iss: TOKEN_ISSUERS.WEB,
      aud: TOKEN_AUDIENCES.WEB,
    });
    expect(jwt.verify(oauthExchangeToken, JWT_SECRET, { algorithms: ["HS256"] })).toMatchObject({
      tokenType: TOKEN_TYPES.OAUTH_EXCHANGE,
      iss: TOKEN_ISSUERS.API,
      aud: TOKEN_AUDIENCES.WEB,
    });
  });

  it.each([
    ["API", verifyApiSessionToken],
    ["Socket", verifySocketSessionToken],
  ])("%s session verification rejects wrong or missing issuer/audience claims", (_name, verifier) => {
    const wrongIssuerToken = signRawToken(TOKEN_TYPES.SESSION, {
      issuer: TOKEN_ISSUERS.API,
    });
    const missingIssuerToken = signRawToken(TOKEN_TYPES.SESSION, {
      includeIssuer: false,
    });
    const missingAudienceToken = signRawToken(TOKEN_TYPES.SESSION, {
      includeAudience: false,
    });

    expect(() => verifier(wrongIssuerToken)).toThrow();
    expect(() => verifier(missingIssuerToken)).toThrow();
    expect(() => verifier(missingAudienceToken)).toThrow();
  });

  it("API and Socket session verifiers each reject a token missing their boundary audience", () => {
    const noApiAudienceToken = signRawToken(TOKEN_TYPES.SESSION, {
      audience: [TOKEN_AUDIENCES.WEB, TOKEN_AUDIENCES.SOCKET],
    });
    const noSocketAudienceToken = signRawToken(TOKEN_TYPES.SESSION, {
      audience: [TOKEN_AUDIENCES.WEB, TOKEN_AUDIENCES.API],
    });

    expect(() => verifyApiSessionToken(noApiAudienceToken)).toThrow();
    expect(() => verifySocketSessionToken(noSocketAudienceToken)).toThrow();
  });

  it.each([
    ["a non-HS256 algorithm", () => signCustomSessionToken({ algorithm: "HS384" })],
    ["an invalid signature", () => signCustomSessionToken({ signingSecret: "other-test-secret" })],
    ["a missing userId", () => signCustomSessionToken({ includeUserId: false })],
    ["an empty userId", () => signCustomSessionToken({ userId: "" })],
    ["a missing expiresAt", () => signCustomSessionToken({ includeExpiresAt: false })],
    ["an invalid expiresAt", () => signCustomSessionToken({ expiresAt: "not-a-date" })],
    ["a past expiresAt", () => signCustomSessionToken({
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    })],
    ["a missing exp", () => signCustomSessionToken({ includeExp: false })],
    ["an extra audience", () => signCustomSessionToken({
      audience: [...SESSION_TOKEN_AUDIENCES, "urn:nexuschat:unexpected"],
    })],
  ])("rejects a session token with %s", (_label, createToken) => {
    expect(() => verifyApiSessionToken(createToken())).toThrow();
  });

  it("REST authentication hydrates the selected session user for a valid cookie token", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(SESSION_USER as never);
    const next = vi.fn();
    const request = {
      cookies: { session: signRawToken(TOKEN_TYPES.SESSION) },
      headers: {},
    } as unknown as AuthenticatedRequest;

    await verifyToken(request, {} as Response, next as NextFunction);

    expect(request.user).toBe(SESSION_USER);
    expect(next).toHaveBeenCalledWith();
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: USER_ID },
      select: expect.objectContaining({
        id: true,
        username: true,
        email: true,
        publicKey: true,
      }),
    }));
  });

  it("REST authentication preserves cookie precedence over a Bearer token", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(SESSION_USER as never);
    const next = vi.fn();
    const request = {
      cookies: { session: signRawToken(TOKEN_TYPES.SESSION) },
      headers: {
        authorization: `Bearer ${signRawToken(TOKEN_TYPES.PASSWORD_RESET)}`,
      },
    } as unknown as AuthenticatedRequest;

    await verifyToken(request, {} as Response, next as NextFunction);

    expect(request.user).toBe(SESSION_USER);
    expect(next).toHaveBeenCalledWith();
  });

  it("REST authentication preserves missing, expired, and deleted-user failures", async () => {
    const missingNext = vi.fn();
    await verifyToken(
      { cookies: {}, headers: {} } as unknown as AuthenticatedRequest,
      {} as Response,
      missingNext as NextFunction,
    );
    expect(missingNext).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 401,
      message: "Token missing, please login again",
    }));

    const expiredNext = vi.fn();
    await verifyToken(
      {
        cookies: {},
        headers: { authorization: `Bearer ${signExpiredSessionToken()}` },
      } as unknown as AuthenticatedRequest,
      {} as Response,
      expiredNext as NextFunction,
    );
    expect(expiredNext).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 401,
      message: "Invalid or expired token",
    }));
    expect(prisma.user.findUnique).not.toHaveBeenCalled();

    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    const deletedNext = vi.fn();
    await verifyToken(
      {
        cookies: {},
        headers: { authorization: `Bearer ${signRawToken(TOKEN_TYPES.SESSION)}` },
      } as unknown as AuthenticatedRequest,
      {} as Response,
      deletedNext as NextFunction,
    );
    expect(deletedNext).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 401,
      message: "Invalid or expired token",
    }));
  });

  it("REST authentication forwards repository failures without exposing them itself", async () => {
    vi.mocked(prisma.user.findUnique).mockRejectedValueOnce(
      new Error("obvious-fake-database-detail"),
    );
    const next = vi.fn();

    await verifyToken(
      {
        cookies: {},
        headers: { authorization: `Bearer ${signRawToken(TOKEN_TYPES.SESSION)}` },
      } as unknown as AuthenticatedRequest,
      {} as Response,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({
      code: "SESSION_AUTH_REPOSITORY_FAILURE",
      statusCode: 500,
      message: "Internal server error",
    });
    expect(JSON.stringify(next.mock.calls)).not.toContain("obvious-fake-database-detail");
  });

  it("Socket authentication hydrates the existing user for a valid session token", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(SESSION_USER as never);
    const next = vi.fn();
    const socket = {
      handshake: { query: { token: signRawToken(TOKEN_TYPES.SESSION) } },
    } as unknown as Socket;

    await socketAuthenticatorMiddleware(socket, next as NextFunction);

    expect(socket.user).toEqual({
      id: SESSION_USER.id,
      username: SESSION_USER.username,
      avatar: SESSION_USER.avatar,
    });
    expect(next).toHaveBeenCalledWith();
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: USER_ID },
    }));
  });

  it("Socket authentication rejects array-valued handshake credentials before Prisma", async () => {
    const next = vi.fn();
    await socketAuthenticatorMiddleware(
      { handshake: { query: { token: ["a.b.c"] } } } as unknown as Socket,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 401,
      message: "Invalid token format",
    }));
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("Socket authentication preserves missing, expired, and deleted-user failures", async () => {
    const missingNext = vi.fn();
    await socketAuthenticatorMiddleware(
      { handshake: { query: {} } } as unknown as Socket,
      missingNext as NextFunction,
    );
    expect(missingNext).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 401,
      message: "Token missing, please login again",
    }));

    const expiredNext = vi.fn();
    await socketAuthenticatorMiddleware(
      { handshake: { query: { token: signExpiredSessionToken() } } } as unknown as Socket,
      expiredNext as NextFunction,
    );
    expect(expiredNext).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 401,
      message: "Token expired, please login again",
    }));
    expect(prisma.user.findUnique).not.toHaveBeenCalled();

    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    const deletedNext = vi.fn();
    await socketAuthenticatorMiddleware(
      {
        handshake: { query: { token: signRawToken(TOKEN_TYPES.SESSION) } },
      } as unknown as Socket,
      deletedNext as NextFunction,
    );
    expect(deletedNext).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 401,
      message: "Invalid Token, please login again",
    }));
  });

  it("Socket authentication conceals and sanitizes repository failures", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(prisma.user.findUnique).mockRejectedValueOnce(
      new Error("obvious-fake-database-detail"),
    );
    const next = vi.fn();

    await socketAuthenticatorMiddleware(
      {
        handshake: { query: { token: signRawToken(TOKEN_TYPES.SESSION) } },
      } as unknown as Socket,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 401,
      message: "Invalid Token, please login again",
    }));
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("obvious-fake-database-detail");
    errorLog.mockRestore();
  });

  it.each([
    TOKEN_TYPES.PASSWORD_RESET,
    TOKEN_TYPES.PRIVATE_KEY_RECOVERY,
    TOKEN_TYPES.OAUTH_EXCHANGE,
    undefined,
  ])("REST authentication rejects %s tokens before loading a user", async (tokenType) => {
    const next = vi.fn();
    const request = {
      cookies: {},
      headers: { authorization: `Bearer ${signRawToken(tokenType)}` },
    } as unknown as AuthenticatedRequest;

    await verifyToken(request, {} as Response, next as NextFunction);

    getRejectedAuthError(next, "Invalid or expired token");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong issuer", { issuer: TOKEN_ISSUERS.API }],
    ["wrong audience", { audience: [TOKEN_AUDIENCES.WEB, TOKEN_AUDIENCES.SOCKET] }],
  ])("REST authentication rejects a session-shaped token with %s", async (_label, options) => {
    const next = vi.fn();
    const request = {
      cookies: {},
      headers: {
        authorization: `Bearer ${signRawToken(TOKEN_TYPES.SESSION, options)}`,
      },
    } as unknown as AuthenticatedRequest;

    await verifyToken(request, {} as Response, next as NextFunction);

    getRejectedAuthError(next, "Invalid or expired token");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    TOKEN_TYPES.PASSWORD_RESET,
    TOKEN_TYPES.PRIVATE_KEY_RECOVERY,
    TOKEN_TYPES.OAUTH_EXCHANGE,
    undefined,
  ])("Socket authentication rejects %s tokens before loading a user", async (tokenType) => {
    const next = vi.fn();
    const socket = {
      handshake: { query: { token: signRawToken(tokenType) } },
    } as unknown as Socket;

    await socketAuthenticatorMiddleware(socket, next as NextFunction);

    getRejectedAuthError(next, "Invalid token format");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong issuer", { issuer: TOKEN_ISSUERS.API }],
    ["wrong audience", { audience: [TOKEN_AUDIENCES.WEB, TOKEN_AUDIENCES.API] }],
  ])("Socket authentication rejects a session-shaped token with %s", async (_label, options) => {
    const next = vi.fn();
    const socket = {
      handshake: {
        query: { token: signRawToken(TOKEN_TYPES.SESSION, options) },
      },
    } as unknown as Socket;

    await socketAuthenticatorMiddleware(socket, next as NextFunction);

    getRejectedAuthError(next, "Invalid token format");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

});
