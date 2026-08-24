import type { NextFunction, Response } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
} from "../src/utils/jwt.utils.js";

const JWT_SECRET = "phase-1c-1a-test-secret";
const USER_ID = "token-purpose-user";
const futureExpiry = () => new Date(Date.now() + 60 * 60 * 1000);

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

const getRejectedAuthError = (next: ReturnType<typeof vi.fn>) => {
  expect(next).toHaveBeenCalledTimes(1);
  const error = next.mock.calls[0]?.[0];
  expect(error).toMatchObject({ statusCode: 401 });
};

describe("backend token-purpose enforcement", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
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

    getRejectedAuthError(next);
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

    getRejectedAuthError(next);
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

    getRejectedAuthError(next);
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

    getRejectedAuthError(next);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("requires JWT_SECRET at runtime", () => {
    delete process.env.JWT_SECRET;

    expect(() => signPasswordResetToken({ userId: USER_ID, expiresAt: futureExpiry() })).toThrow(
      "JWT_SECRET",
    );
  });
});
