import type { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
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
import { prisma } from "../src/lib/prisma.lib.js";
import { socketAuthenticatorMiddleware } from "../src/middlewares/socket-auth.middleware.js";
import { verifyToken } from "../src/middlewares/verify-token.middleware.js";
import {
  signOAuthExchangeToken,
  signPasswordResetToken,
  TOKEN_TYPES,
  verifySessionToken,
} from "../src/utils/jwt.utils.js";

const JWT_SECRET = "phase-1c-1a-test-secret";
const USER_ID = "token-purpose-user";
const futureExpiry = () => new Date(Date.now() + 60 * 60 * 1000);

const signRawToken = (tokenType?: string) =>
  jwt.sign(
    {
      ...(tokenType ? { tokenType } : {}),
      userId: USER_ID,
      expiresAt: futureExpiry().toISOString(),
      ...(tokenType === TOKEN_TYPES.OAUTH_EXCHANGE ? { isNewUser: false } : {}),
    },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: "1h" },
  );

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

    expect(verifySessionToken(sessionToken)).toMatchObject({
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
    expect(() => verifySessionToken(signRawToken(tokenType))).toThrow();
  });

  it("purpose-specific signers cannot be overridden by caller input", () => {
    const passwordResetToken = signPasswordResetToken({
      userId: USER_ID,
      expiresAt: futureExpiry(),
      tokenType: TOKEN_TYPES.SESSION,
    } as Parameters<typeof signPasswordResetToken>[0]);
    const oauthExchangeToken = signOAuthExchangeToken({
      userId: USER_ID,
      isNewUser: false,
      email: "user@example.com",
      tokenType: TOKEN_TYPES.SESSION,
    } as Parameters<typeof signOAuthExchangeToken>[0]);

    expect(jwt.verify(passwordResetToken, JWT_SECRET, { algorithms: ["HS256"] })).toMatchObject({
      tokenType: TOKEN_TYPES.PASSWORD_RESET,
    });
    expect(jwt.verify(oauthExchangeToken, JWT_SECRET, { algorithms: ["HS256"] })).toMatchObject({
      tokenType: TOKEN_TYPES.OAUTH_EXCHANGE,
    });
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

  it("requires JWT_SECRET at runtime", () => {
    delete process.env.JWT_SECRET;

    expect(() => signPasswordResetToken({ userId: USER_ID, expiresAt: futureExpiry() })).toThrow(
      "JWT_SECRET",
    );
  });
});
