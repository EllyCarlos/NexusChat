import { readFileSync } from "node:fs";
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
import { metadata } from "../src/app/auth/oauth-redirect/layout";
import {
  getOAuthAuthenticationPlan,
  getOAuthMigrationCompletionPlan,
  readAndScrubOAuthExchangeToken,
} from "../src/lib/client/oauthRedirect";

const EXCHANGE_TOKEN = "purpose-bound-oauth-exchange-token";
const SESSION_TOKEN = "normal-session-token";
const USER_ID = "oauth-user";

const oauthUser = {
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
};

describe("OAuth redirect exposure hardening", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "oauth-redirect-test-secret";
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
    mocks.findUser.mockResolvedValue(oauthUser);
  });

  it("reads the fragment exchange token and scrubs it from browser history immediately", () => {
    const replaceState = vi.fn();

    const token = readAndScrubOAuthExchangeToken({
      location: {
        pathname: "/auth/oauth-redirect",
        hash: `#token=${encodeURIComponent(EXCHANGE_TOKEN)}`,
      },
      history: { replaceState },
    });

    expect(token).toBe(EXCHANGE_TOKEN);
    expect(replaceState).toHaveBeenCalledWith({}, "", "/auth/oauth-redirect");
    expect(replaceState.mock.calls.flat().join(" ")).not.toContain(EXCHANGE_TOKEN);
  });

  it("handles direct OAuth redirect-page navigation without inventing a token", () => {
    const replaceState = vi.fn();

    const token = readAndScrubOAuthExchangeToken({
      location: { pathname: "/auth/oauth-redirect", hash: "" },
      history: { replaceState },
    });

    expect(token).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("uses fragment-only capture and a route-scoped no-referrer policy", () => {
    const pageSource = readFileSync(
      new URL("../src/app/auth/oauth-redirect/page.tsx", import.meta.url),
      "utf8",
    );

    expect(pageSource).toContain("readAndScrubOAuthExchangeToken");
    expect(pageSource).not.toContain("searchParams.get('token')");
    expect(pageSource).not.toContain("?token=");
    expect(metadata.referrer).toBe("no-referrer");
  });

  it("still exchanges a valid purpose-bound token for a normal session", async () => {
    const result = await verifyOAuthToken(undefined, EXCHANGE_TOKEN);

    expect(mocks.verifyOAuthExchangeToken).toHaveBeenCalledWith(EXCHANGE_TOKEN);
    expect(mocks.createSession).toHaveBeenCalledWith(USER_ID);
    expect(result.data?.sessionToken).toBe(SESSION_TOKEN);
  });

  it("still rejects an invalid or wrong-purpose exchange token", async () => {
    mocks.verifyOAuthExchangeToken.mockResolvedValueOnce(null);

    const result = await verifyOAuthToken(undefined, "session-purpose-token");

    expect(result.errors.message).toBe("Invalid or expired OAuth exchange token");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("documents that a stolen exchange JWT remains replayable during its short expiry", async () => {
    const firstResult = await verifyOAuthToken(undefined, EXCHANGE_TOKEN);
    const secondResult = await verifyOAuthToken(undefined, EXCHANGE_TOKEN);

    expect(firstResult.data?.sessionToken).toBe(SESSION_TOKEN);
    expect(secondResult.data?.sessionToken).toBe(SESSION_TOKEN);
    expect(mocks.createSession).toHaveBeenCalledTimes(2);
  });

  it("preserves OAuth V2 key provisioning and migration wiring", () => {
    const pageSource = readFileSync(
      new URL("../src/app/auth/oauth-redirect/page.tsx", import.meta.url),
      "utf8",
    );

    expect(pageSource).toContain("useStoreNewOAuthV2UserKeys");
    expect(pageSource).toContain("useMigrateOAuthPrivateKeyBackupToV2");
    expect(pageSource).toContain("oauthSetup");
    expect(pageSource).toContain("oauthMigration");
  });

  it("plans a normal existing-user OAuth login success and delayed redirect", () => {
    expect(getOAuthAuthenticationPlan({})).toEqual({
      kind: "login",
      message: "Successfully logged in!",
      redirectTo: "/",
      delayMs: 1_000,
    });
  });

  it("keeps OAuth setup active without an ordinary login redirect", () => {
    expect(getOAuthAuthenticationPlan({ oauthSetup: { recoverySecret: "setup" } })).toEqual({
      kind: "setup",
    });
  });

  it("plans an OAuth migration preparation error and immediate redirect", () => {
    expect(getOAuthAuthenticationPlan({ oauthMigrationError: true })).toEqual({
      kind: "migration-error",
      message: "Private-key backup migration was not completed.",
      redirectTo: "/",
    });
  });

  it("does not plan an ordinary redirect while OAuth migration is active", () => {
    expect(getOAuthAuthenticationPlan({ oauthMigration: { version: 2 } })).toEqual({
      kind: "migration",
    });
  });

  it("plans success and redirect only after OAuth migration succeeds", () => {
    expect(getOAuthMigrationCompletionPlan("succeeded")).toEqual({
      kind: "succeeded",
      message: "Successfully logged in!",
      redirectTo: "/",
    });
  });

  it("plans an error and redirect only after OAuth migration fails", () => {
    expect(getOAuthMigrationCompletionPlan("failed")).toEqual({
      kind: "failed",
      message: "Private-key backup migration was not completed.",
      redirectTo: "/",
    });
  });
});
