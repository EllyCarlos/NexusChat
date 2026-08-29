import type { NextFunction, Response } from "express";
import type { Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env.config.js", () => ({
  config: { auth: { jwtSecret: "obvious-fake-adapter-secret" } },
}));
vi.mock("../src/modules/auth/infrastructure/prisma-auth-identity.repository.js", () => ({
  prismaAuthIdentityRepository: { findSessionIdentityById: vi.fn() },
}));

import type { AuthenticatedRequest } from "../src/interfaces/auth/auth.interface.js";
import {
  SessionAuthenticationError,
} from "../src/modules/auth/application/authenticate-session.js";
import type { AuthenticatedIdentity } from "../src/modules/auth/contracts/auth-identity.js";
import {
  createSocketAuthenticatorMiddleware,
} from "../src/middlewares/socket-auth.middleware.js";
import {
  createVerifyTokenMiddleware,
  extractRestSessionToken,
} from "../src/middlewares/verify-token.middleware.js";

const IDENTITY = {
  id: "adapter-user",
  name: "Adapter User",
  username: "adapter-user",
  avatar: "https://example.test/avatar.png",
  email: "adapter@example.test",
  createdAt: new Date(),
  updatedAt: new Date(),
  emailVerified: true,
  publicKey: null,
  needsKeyRecovery: false,
  keyRecoveryCompletedAt: null,
  notificationsEnabled: true,
  verificationBadge: false,
  fcmToken: null,
  oAuthSignup: false,
} satisfies AuthenticatedIdentity;

describe("REST authentication adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts a session cookie before a Bearer credential", () => {
    expect(extractRestSessionToken({
      cookies: { session: "cookie-token" },
      headers: { authorization: "Bearer bearer-token" },
    } as unknown as AuthenticatedRequest)).toBe("cookie-token");
    expect(extractRestSessionToken({
      cookies: {},
      headers: { authorization: "Bearer bearer-token" },
    } as unknown as AuthenticatedRequest)).toBe("bearer-token");
  });

  it("invokes the API application operation and assigns req.user", async () => {
    const authenticate = vi.fn().mockResolvedValue(IDENTITY);
    const middleware = createVerifyTokenMiddleware(authenticate);
    const request = {
      cookies: { session: "cookie-token" },
      headers: {},
    } as unknown as AuthenticatedRequest;
    const next = vi.fn();

    await middleware(request, {} as Response, next as NextFunction);

    expect(authenticate).toHaveBeenCalledWith({ token: "cookie-token", boundary: "api" });
    expect(request.user).toBe(IDENTITY);
    expect(next).toHaveBeenCalledWith();
  });

  it("preserves missing credentials and forwards non-auth application failures", async () => {
    const authenticate = vi.fn();
    const middleware = createVerifyTokenMiddleware(authenticate);
    const missingNext = vi.fn();

    await middleware(
      { cookies: {}, headers: {} } as unknown as AuthenticatedRequest,
      {} as Response,
      missingNext as NextFunction,
    );
    expect(missingNext).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 401,
      message: "Token missing, please login again",
    }));
    expect(authenticate).not.toHaveBeenCalled();

    const failure = new Error("downstream failure");
    authenticate.mockRejectedValueOnce(failure);
    const failureNext = vi.fn();
    await middleware(
      { cookies: { session: "cookie-token" }, headers: {} } as unknown as AuthenticatedRequest,
      {} as Response,
      failureNext as NextFunction,
    );
    expect(failureNext).toHaveBeenCalledWith(failure);
  });
});

describe("Socket authentication adapter", () => {
  it("invokes the shared operation and assigns only the Socket identity", async () => {
    const authenticate = vi.fn().mockResolvedValue(IDENTITY);
    const middleware = createSocketAuthenticatorMiddleware(authenticate);
    const socket = {
      handshake: { query: { token: "aaa.bbb.ccc" } },
    } as unknown as Socket;
    const next = vi.fn();

    await middleware(socket, next as NextFunction);

    expect(authenticate).toHaveBeenCalledWith({ token: "aaa.bbb.ccc", boundary: "socket" });
    expect(socket.user).toEqual({
      id: IDENTITY.id,
      username: IDENTITY.username,
      avatar: IDENTITY.avatar,
    });
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects missing and malformed credentials before application work", async () => {
    const authenticate = vi.fn();
    const middleware = createSocketAuthenticatorMiddleware(authenticate);
    const missingNext = vi.fn();
    const malformedNext = vi.fn();

    await middleware(
      { handshake: { query: {} } } as unknown as Socket,
      missingNext as NextFunction,
    );
    await middleware(
      { handshake: { query: { token: ["aaa.bbb.ccc"] } } } as unknown as Socket,
      malformedNext as NextFunction,
    );

    expect(missingNext).toHaveBeenCalledWith(expect.objectContaining({
      message: "Token missing, please login again",
    }));
    expect(malformedNext).toHaveBeenCalledWith(expect.objectContaining({
      message: "Invalid token format",
    }));
    expect(authenticate).not.toHaveBeenCalled();
  });

  it.each([
    ["token_expired", "Token expired, please login again"],
    ["token_invalid", "Invalid token format"],
    ["identity_not_found", "Invalid Token, please login again"],
  ] as const)("maps %s without changing Socket errors", async (reason, message) => {
    const authenticate = vi.fn().mockRejectedValue(new SessionAuthenticationError(reason));
    const middleware = createSocketAuthenticatorMiddleware(authenticate);
    const next = vi.fn();

    await middleware(
      { handshake: { query: { token: "aaa.bbb.ccc" } } } as unknown as Socket,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401, message }));
  });
});
