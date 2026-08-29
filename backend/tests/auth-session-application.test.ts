import jwt from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env.config.js", () => ({
  config: { auth: { jwtSecret: "obvious-fake-auth-service-secret" } },
}));
vi.mock("../src/modules/auth/infrastructure/prisma-auth-identity.repository.js", () => ({
  prismaAuthIdentityRepository: { findSessionIdentityById: vi.fn() },
}));

import {
  createSessionAuthenticator,
  SessionAuthenticationError,
} from "../src/modules/auth/application/authenticate-session.js";
import type { AuthenticatedIdentity } from "../src/modules/auth/contracts/auth-identity.js";
import type { SessionTokenPayload } from "../src/modules/auth/token/session-token.service.js";

const IDENTITY: AuthenticatedIdentity = {
  id: "auth-service-user",
  name: "Auth Service User",
  username: "auth-service-user",
  avatar: "https://example.test/avatar.png",
  email: "auth-service@example.test",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  emailVerified: true,
  publicKey: null,
  needsKeyRecovery: false,
  keyRecoveryCompletedAt: null,
  notificationsEnabled: true,
  verificationBadge: false,
  fcmToken: null,
  oAuthSignup: false,
};

const PAYLOAD: SessionTokenPayload = {
  tokenType: "session",
  userId: IDENTITY.id,
  iss: "urn:nexuschat:web",
  aud: ["urn:nexuschat:web", "urn:nexuschat:api", "urn:nexuschat:socket"],
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  exp: Math.floor(Date.now() / 1000) + 60,
};

describe("authenticateSession application operation", () => {
  it("verifies the requested boundary and returns the loaded identity", async () => {
    const findSessionIdentityById = vi.fn().mockResolvedValue(IDENTITY);
    const verifyToken = vi.fn().mockReturnValue(PAYLOAD);
    const authenticate = createSessionAuthenticator({
      identityRepository: { findSessionIdentityById },
      verifyToken,
    });

    await expect(authenticate({ token: "opaque-session", boundary: "api" }))
      .resolves.toBe(IDENTITY);
    expect(verifyToken).toHaveBeenCalledWith("opaque-session", "api");
    expect(findSessionIdentityById).toHaveBeenCalledWith(IDENTITY.id);
  });

  it.each([
    ["expired", new jwt.TokenExpiredError("expired detail", new Date()), "token_expired"],
    ["invalid", new jwt.JsonWebTokenError("invalid detail"), "token_invalid"],
    ["unexpected", new Error("unexpected verifier detail"), "token_verification_failed"],
  ])("normalizes %s verifier failures", async (_label, verifierError, reason) => {
    const findSessionIdentityById = vi.fn();
    const authenticate = createSessionAuthenticator({
      identityRepository: { findSessionIdentityById },
      verifyToken: vi.fn(() => { throw verifierError; }),
    });

    await expect(authenticate({ token: "must-not-appear", boundary: "socket" }))
      .rejects.toMatchObject({ reason, statusCode: 401 });
    expect(findSessionIdentityById).not.toHaveBeenCalled();
  });

  it("rejects a deleted identity safely", async () => {
    const authenticate = createSessionAuthenticator({
      identityRepository: { findSessionIdentityById: vi.fn().mockResolvedValue(null) },
      verifyToken: vi.fn().mockReturnValue(PAYLOAD),
    });

    await expect(authenticate({ token: "opaque-session", boundary: "api" }))
      .rejects.toMatchObject({
        reason: "identity_not_found",
        statusCode: 401,
      });
  });

  it("sanitizes repository failures without retaining token or database details", async () => {
    const authenticate = createSessionAuthenticator({
      identityRepository: {
        findSessionIdentityById: vi.fn().mockRejectedValue(
          new Error("obvious-fake-private-database-detail"),
        ),
      },
      verifyToken: vi.fn().mockReturnValue(PAYLOAD),
    });

    let thrown: unknown;
    try {
      await authenticate({ token: "obvious-fake-private-token", boundary: "api" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SessionAuthenticationError);
    expect(thrown).toMatchObject({
      reason: "repository_failure",
      statusCode: 500,
      message: "Internal server error",
    });
    expect(JSON.stringify(thrown)).not.toContain("obvious-fake-private-database-detail");
    expect(JSON.stringify(thrown)).not.toContain("obvious-fake-private-token");
  });
});
