import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  findUser: vi.fn(),
  verifyOAuthExchangeToken: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({
  createSession: mocks.createSession,
  deleteSession: vi.fn(),
  signPasswordResetToken: vi.fn(),
  signPrivateKeyRecoveryToken: vi.fn(),
  verifyOAuthExchangeToken: mocks.verifyOAuthExchangeToken,
  verifyPasswordResetToken: vi.fn(),
  verifyPrivateKeyRecoveryToken: vi.fn(),
  verifySession: vi.fn(),
  verifySessionToken: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUser },
  },
}));

vi.mock("@/lib/server/email/SendEmail", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/server/helpers", () => ({ generateOtp: vi.fn() }));
vi.mock("@/lib/client/privateKeyEnvelope", () => ({
  decryptPrivateKeyV2: vi.fn(),
  parsePrivateKeyBackup: vi.fn(),
  parsePrivateKeyEnvelopeV2: vi.fn(),
  validateNexusChatPublicJsonWebKey: vi.fn(),
}));
vi.mock("@/lib/server/privateKeyRecoveryKeyWrap", () => ({
  generatePerUserRecoverySecret: vi.fn(),
  PrivateKeyRecoveryKeyWrapError: class PrivateKeyRecoveryKeyWrapError extends Error {},
  unwrapRecoverySecret: vi.fn(),
  wrapRecoverySecret: vi.fn(),
}));

import { verifyOAuthToken } from "../src/actions/auth.actions";

const EXCHANGE_TOKEN = "oauth-exchange-jwt";
const SESSION_TOKEN = "purpose-bound-session-jwt";
const USER_ID = "oauth-user";

describe("OAuth session propagation", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "phase-1c-1a-test-secret";
    vi.clearAllMocks();
    mocks.verifyOAuthExchangeToken.mockResolvedValue({
      tokenType: "oauth_exchange",
      userId: USER_ID,
      iss: "urn:nexuschat:api",
      aud: "urn:nexuschat:web",
      isNewUser: false,
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    mocks.createSession.mockResolvedValue(SESSION_TOKEN);
    mocks.findUser.mockResolvedValue({
      id: USER_ID,
      name: "OAuth User",
      username: "oauth-user",
      avatar: null,
      email: "oauth@example.com",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
      emailVerified: true,
      publicKey: null,
      notificationsEnabled: true,
      verificationBadge: false,
      fcmToken: null,
      oAuthSignup: false,
      privateKey: null,
    });
  });

  it("returns the created session JWT instead of the consumed OAuth exchange JWT", async () => {
    const result = await verifyOAuthToken(undefined, EXCHANGE_TOKEN);

    expect(mocks.verifyOAuthExchangeToken).toHaveBeenCalledWith(EXCHANGE_TOKEN);
    expect(mocks.createSession).toHaveBeenCalledWith(USER_ID);
    expect(result.data?.sessionToken).toBe(SESSION_TOKEN);
    expect(result.data?.sessionToken).not.toBe(EXCHANGE_TOKEN);
  });
});
