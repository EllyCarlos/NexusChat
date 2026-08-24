import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedSession: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  signPasswordResetToken: vi.fn(),
  signPrivateKeyRecoveryToken: vi.fn(),
  verifyOAuthExchangeToken: vi.fn(),
  verifyPasswordResetToken: vi.fn(),
  verifyPrivateKeyRecoveryToken: vi.fn(),
  findUser: vi.fn(),
  findUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  updateManyUsers: vi.fn(),
  deleteOtps: vi.fn(),
  createOtp: vi.fn(),
  findOtp: vi.fn(),
  deleteOtp: vi.fn(),
  deletePrivateKeyRecoveryTokens: vi.fn(),
  createPrivateKeyRecoveryToken: vi.fn(),
  findPrivateKeyRecoveryToken: vi.fn(),
  deletePrivateKeyRecoveryToken: vi.fn(),
  deleteResetPasswordTokens: vi.fn(),
  createResetPasswordToken: vi.fn(),
  findResetPasswordToken: vi.fn(),
  deleteResetPasswordToken: vi.fn(),
  transaction: vi.fn(),
  sendEmail: vi.fn(),
  generateOtp: vi.fn(),
  hash: vi.fn(),
  compare: vi.fn(),
  parsePrivateKeyBackup: vi.fn(),
}));

vi.mock("@/lib/server/authenticatedSession", () => ({
  getAuthenticatedSession: mocks.getAuthenticatedSession,
}));

vi.mock("@/lib/server/session", () => ({
  createSession: mocks.createSession,
  deleteSession: mocks.deleteSession,
  signPasswordResetToken: mocks.signPasswordResetToken,
  signPrivateKeyRecoveryToken: mocks.signPrivateKeyRecoveryToken,
  verifyOAuthExchangeToken: mocks.verifyOAuthExchangeToken,
  verifyPasswordResetToken: mocks.verifyPasswordResetToken,
  verifyPrivateKeyRecoveryToken: mocks.verifyPrivateKeyRecoveryToken,
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUser,
      findMany: mocks.findUsers,
      create: mocks.createUser,
      update: mocks.updateUser,
      updateMany: mocks.updateManyUsers,
    },
    otp: {
      deleteMany: mocks.deleteOtps,
      create: mocks.createOtp,
      findFirst: mocks.findOtp,
      delete: mocks.deleteOtp,
    },
    privateKeyRecoveryToken: {
      deleteMany: mocks.deletePrivateKeyRecoveryTokens,
      create: mocks.createPrivateKeyRecoveryToken,
      findFirst: mocks.findPrivateKeyRecoveryToken,
      delete: mocks.deletePrivateKeyRecoveryToken,
    },
    resetPasswordToken: {
      deleteMany: mocks.deleteResetPasswordTokens,
      create: mocks.createResetPasswordToken,
      findFirst: mocks.findResetPasswordToken,
      delete: mocks.deleteResetPasswordToken,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/server/email/SendEmail", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/server/helpers", () => ({ generateOtp: mocks.generateOtp }));
vi.mock("bcryptjs", () => ({
  default: {
    hash: mocks.hash,
    compare: mocks.compare,
  },
}));
vi.mock("@/lib/client/privateKeyEnvelope", () => ({
  decryptPrivateKeyV2: vi.fn(),
  parsePrivateKeyBackup: mocks.parsePrivateKeyBackup,
  parsePrivateKeyEnvelopeV2: vi.fn(),
  validateNexusChatPublicJsonWebKey: vi.fn(),
}));
vi.mock("@/lib/server/privateKeyRecoveryKeyWrap", () => ({
  generatePerUserRecoverySecret: vi.fn(),
  PrivateKeyRecoveryKeyWrapError: class PrivateKeyRecoveryKeyWrapError extends Error {},
  unwrapRecoverySecret: vi.fn(),
  wrapRecoverySecret: vi.fn(),
}));

import {
  forgotPassword,
  login,
  resetPassword,
  sendOtp,
  sendPrivateKeyRecoveryEmail,
  signup,
  storeUserKeysInDatabase,
  verifyOtp,
  verifyOAuthToken,
  verifyPassword,
  verifyPrivateKeyRecoveryToken,
} from "../src/actions/auth.actions";
import {
  searchUser,
  storeFcmToken,
  updateUserNotificationStatus,
} from "../src/actions/user.actions";
import {
  BoundedInMemoryRateLimiter,
  clearServerActionRateLimitsForTests,
  RATE_LIMIT_MESSAGE,
} from "../src/lib/server/rateLimit";

const ACTOR_ID = "user-a";
const OTHER_USER_ID = "user-b";
const ACTOR_EMAIL = "user-a@example.com";
const ACTOR_USERNAME = "user-a";
const OTP_VALUE = "1234";
const FUTURE_DATE = new Date(Date.now() + 5 * 60 * 1000);

const actor = () => ({
  id: ACTOR_ID,
  email: ACTOR_EMAIL,
  username: ACTOR_USERNAME,
  hashedPassword: "stored-password-hash",
  oAuthSignup: false,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Server Action authentication and ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearServerActionRateLimitsForTests();
    mocks.getAuthenticatedSession.mockResolvedValue({
      userId: ACTOR_ID,
      token: "session-token-a",
    });
    mocks.findUser.mockResolvedValue(actor());
    mocks.findUsers.mockResolvedValue([]);
    mocks.createUser.mockResolvedValue(actor());
    mocks.updateUser.mockResolvedValue({ publicKey: "stored-public-key" });
    mocks.updateManyUsers.mockResolvedValue({ count: 1 });
    mocks.deleteOtps.mockResolvedValue({ count: 0 });
    mocks.createOtp.mockResolvedValue({ id: "otp-a" });
    mocks.findOtp.mockResolvedValue({
      id: "otp-a",
      userId: ACTOR_ID,
      hashedOtp: "hashed-otp",
      expiresAt: FUTURE_DATE,
    });
    mocks.deleteOtp.mockResolvedValue({ id: "otp-a" });
    mocks.deletePrivateKeyRecoveryTokens.mockResolvedValue({ count: 0 });
    mocks.createPrivateKeyRecoveryToken.mockResolvedValue({ id: "recovery-a" });
    mocks.findPrivateKeyRecoveryToken.mockResolvedValue(null);
    mocks.deleteResetPasswordTokens.mockResolvedValue({ count: 0 });
    mocks.createResetPasswordToken.mockResolvedValue({ id: "reset-a" });
    mocks.deleteResetPasswordToken.mockResolvedValue({ id: "reset-a" });
    mocks.transaction.mockImplementation(async (operations: Promise<unknown>[]) =>
      Promise.all(operations)
    );
    mocks.generateOtp.mockReturnValue(OTP_VALUE);
    mocks.hash.mockResolvedValue("hashed-value");
    mocks.compare.mockResolvedValue(true);
    mocks.signPrivateKeyRecoveryToken.mockResolvedValue("private-key-recovery-jwt");
    mocks.signPasswordResetToken.mockResolvedValue("password-reset-jwt");
    mocks.createSession.mockResolvedValue("new-session-token");
    mocks.parsePrivateKeyBackup.mockReturnValue({ format: "legacy-v1" });
  });

  it("rejects unauthenticated sendOtp without DB or email side effects", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(null);

    const result = await sendOtp(undefined);

    expect(result.errors.message).toBe("Authentication is required.");
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.createOtp).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("ignores forged OTP owner and destination fields and uses the session account", async () => {
    const callWithForgedPayload = sendOtp as unknown as (
      previousState: unknown,
      payload: { loggedInUserId: string; email: string; username: string }
    ) => ReturnType<typeof sendOtp>;

    const result = await callWithForgedPayload(undefined, {
      loggedInUserId: OTHER_USER_ID,
      email: "attacker-controlled@example.com",
      username: "user-b",
    });

    expect(mocks.findUser).toHaveBeenCalledWith({
      where: { id: ACTOR_ID },
      select: { id: true, email: true, username: true },
    });
    expect(mocks.deleteOtps).toHaveBeenCalledWith({ where: { userId: ACTOR_ID } });
    expect(mocks.createOtp).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: ACTOR_ID, hashedOtp: "hashed-value" }),
    });
    expect(mocks.sendEmail).toHaveBeenCalledWith({
      emailType: "OTP",
      to: ACTOR_EMAIL,
      username: ACTOR_USERNAME,
      otp: OTP_VALUE,
    });
    expect(result.success.message).toContain(ACTOR_EMAIL);
    expect(result.success.message).not.toContain("attacker-controlled@example.com");
  });

  it("verifies only the session user's OTP despite a forged target ID", async () => {
    const result = await verifyOtp(undefined, {
      otp: OTP_VALUE,
      loggedInUserId: OTHER_USER_ID,
    } as { otp: string });

    expect(result.errors.message).toBeNull();
    expect(mocks.findOtp).toHaveBeenCalledWith({ where: { userId: ACTOR_ID } });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: { id: ACTOR_ID },
      data: { emailVerified: true },
    });
    expect(mocks.updateUser).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: OTHER_USER_ID } })
    );
  });

  it("cannot use another user's valid OTP to mutate that other user", async () => {
    mocks.findOtp.mockImplementation(async ({ where }: { where: { userId: string } }) =>
      where.userId === OTHER_USER_ID
        ? {
            id: "otp-b",
            userId: OTHER_USER_ID,
            hashedOtp: "valid-hash-for-b",
            expiresAt: FUTURE_DATE,
          }
        : null
    );

    const result = await verifyOtp(undefined, {
      otp: OTP_VALUE,
      loggedInUserId: OTHER_USER_ID,
    } as { otp: string });

    expect(result.errors.message).toBe("OTP does not exist or has already been used.");
    expect(mocks.compare).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("consumes a successful OTP once", async () => {
    mocks.findOtp
      .mockResolvedValueOnce({
        id: "otp-a",
        userId: ACTOR_ID,
        hashedOtp: "hashed-otp",
        expiresAt: FUTURE_DATE,
      })
      .mockResolvedValueOnce(null);

    const firstResult = await verifyOtp(undefined, { otp: OTP_VALUE });
    const secondResult = await verifyOtp(undefined, { otp: OTP_VALUE });

    expect(firstResult.errors.message).toBeNull();
    expect(secondResult.errors.message).toBe("OTP does not exist or has already been used.");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.deleteOtp).toHaveBeenCalledWith({ where: { id: "otp-a" } });
  });

  it("attaches an FCM token only to the session user despite a forged ID", async () => {
    const result = await storeFcmToken(undefined, {
      fcmToken: "client-fcm-token",
      loggedInUserId: OTHER_USER_ID,
    } as { fcmToken: string });

    expect(result.errors.message).toBeNull();
    expect(mocks.findUser).toHaveBeenCalledWith({ where: { id: ACTOR_ID } });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: { id: ACTOR_ID },
      data: { fcmToken: "client-fcm-token" },
    });
  });

  it("updates notification preferences only for the session user", async () => {
    const result = await updateUserNotificationStatus(undefined, {
      notificationStatus: false,
      loggedInUserId: OTHER_USER_ID,
    } as { notificationStatus: boolean });

    expect(result.errors.message).toBeNull();
    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: { id: ACTOR_ID },
      data: { notificationsEnabled: false },
    });
  });

  it("rejects unauthenticated user search", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(null);

    const result = await searchUser(undefined, { username: "friend" });

    expect(result.errors.message).toBe("Authentication is required.");
    expect(mocks.findUsers).not.toHaveBeenCalled();
  });

  it("preserves authenticated user search", async () => {
    const searchResults = [{ id: OTHER_USER_ID, username: "user-b", name: "B", avatar: null }];
    mocks.findUsers.mockResolvedValue(searchResults);

    const result = await searchUser(undefined, { username: " user-b " });

    expect(mocks.findUsers).toHaveBeenCalledWith(expect.objectContaining({
      where: { username: { contains: "user-b", mode: "insensitive" } },
    }));
    expect(result.data).toEqual(searchResults);
  });

  it("keeps login public and creates a session from validated credentials", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(null);
    const formData = new FormData();
    formData.set("email", ACTOR_EMAIL);
    formData.set("password", "correct-password");

    const result = await login(undefined, formData);

    expect(result.redirect).toBe(true);
    expect(mocks.createSession).toHaveBeenCalledWith(ACTOR_ID);
    expect(mocks.getAuthenticatedSession).not.toHaveBeenCalled();
  });

  it("keeps signup public and creates the new user's session", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(null);
    mocks.findUser.mockResolvedValue(null);
    mocks.createUser.mockResolvedValue(actor());
    const formData = new FormData();
    formData.set("name", "User A");
    formData.set("username", ACTOR_USERNAME);
    formData.set("email", ACTOR_EMAIL);
    formData.set("password", "new-password");

    const result = await signup(undefined, formData);

    expect(result.errors).toBeNull();
    expect(mocks.createSession).toHaveBeenCalledWith(ACTOR_ID);
    expect(mocks.getAuthenticatedSession).not.toHaveBeenCalled();
  });

  it("keeps forgot-password public", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(null);
    mocks.findUser.mockResolvedValue(null);

    const result = await forgotPassword(undefined, "unknown@example.com");

    expect(result.errors.message).toBeNull();
    expect(result.success.message).toContain("If an account with that email exists");
    expect(mocks.getAuthenticatedSession).not.toHaveBeenCalled();
  });

  it("keeps purpose-token-bound password reset public", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(null);
    mocks.verifyPasswordResetToken.mockResolvedValue({
      userId: ACTOR_ID,
      expiresAt: FUTURE_DATE.toISOString(),
    });
    mocks.findResetPasswordToken.mockResolvedValue({
      id: "reset-a",
      userId: ACTOR_ID,
      hashedToken: "hashed-reset-token",
      expiresAt: FUTURE_DATE,
    });

    const result = await resetPassword(undefined, {
      token: "valid-reset-token",
      newPassword: "replacement-password",
    });

    expect(result.errors.message).toBeNull();
    expect(mocks.verifyPasswordResetToken).toHaveBeenCalledWith("valid-reset-token");
    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: { id: ACTOR_ID },
      data: { hashedPassword: "hashed-value" },
    });
    expect(mocks.getAuthenticatedSession).not.toHaveBeenCalled();
  });

  it("derives password-based private-key recovery ownership from the session", async () => {
    const result = await verifyPassword(undefined, {
      password: "correct-password",
      userId: OTHER_USER_ID,
    } as { password: string });

    expect(result.errors.message).toBeNull();
    expect(mocks.findUser).toHaveBeenCalledWith({ where: { id: ACTOR_ID } });
    expect(mocks.deletePrivateKeyRecoveryTokens).toHaveBeenCalledWith({
      where: { userId: ACTOR_ID },
    });
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: ACTOR_EMAIL,
      username: ACTOR_USERNAME,
    }));
  });

  it("derives email-based private-key recovery ownership and destination from the session", async () => {
    mocks.findUser.mockResolvedValue({ ...actor(), oAuthSignup: true });
    const callWithForgedPayload = sendPrivateKeyRecoveryEmail as unknown as (
      previousState: unknown,
      payload: { id: string; email: string; username: string }
    ) => ReturnType<typeof sendPrivateKeyRecoveryEmail>;

    const result = await callWithForgedPayload(undefined, {
      id: OTHER_USER_ID,
      email: "attacker-controlled@example.com",
      username: "user-b",
    });

    expect(result.errors.message).toBeNull();
    expect(mocks.findUser).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ACTOR_ID },
    }));
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: ACTOR_EMAIL,
      username: ACTOR_USERNAME,
    }));
  });

  it("stores manual-signup keys only for the session user", async () => {
    const publicKey: JsonWebKey = { kty: "EC", crv: "P-256", x: "x", y: "y" };

    const result = await storeUserKeysInDatabase(undefined, {
      privateKey: "encrypted-private-key",
      publicKey,
      loggedInUserId: OTHER_USER_ID,
    } as { privateKey: string; publicKey: JsonWebKey });

    expect(result.errors.message).toBeNull();
    expect(mocks.updateUser).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ACTOR_ID },
    }));
    expect(mocks.updateUser).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: OTHER_USER_ID } })
    );
  });

  describe("non-IP abuse controls", () => {
    it("enforces the OTP resend cooldown per user without affecting another user", async () => {
      const first = await sendOtp(undefined);
      const limited = await sendOtp(undefined);

      mocks.getAuthenticatedSession.mockResolvedValue({ userId: OTHER_USER_ID, token: "session-b" });
      mocks.findUser.mockResolvedValue({
        id: OTHER_USER_ID,
        email: "user-b@example.com",
        username: "user-b",
      });
      const otherUser = await sendOtp(undefined);

      expect(first.errors.message).toBeNull();
      expect(limited.errors.message).toBe(RATE_LIMIT_MESSAGE);
      expect(otherUser.errors.message).toBeNull();
      expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    });

    it("enforces the larger OTP send window even after each resend cooldown", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const result = await sendOtp(undefined);
        expect(result.errors.message, `OTP send attempt ${attempt + 1}`).toBeNull();
        vi.advanceTimersByTime(61_000);
      }

      const limited = await sendOtp(undefined);
      expect(limited.errors.message).toBe(RATE_LIMIT_MESSAGE);
      expect(mocks.sendEmail).toHaveBeenCalledTimes(5);
    });

    it("limits repeated bad OTP guesses and still consumes a valid OTP once", async () => {
      mocks.compare.mockResolvedValue(false);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const result = await verifyOtp(undefined, { otp: "0000" });
        expect(result.errors.message).toBe("Invalid OTP. Please try again.");
      }
      const limited = await verifyOtp(undefined, { otp: "0000" });
      expect(limited.errors.message).toBe(RATE_LIMIT_MESSAGE);
      expect(mocks.compare).toHaveBeenCalledTimes(5);

      clearServerActionRateLimitsForTests();
      mocks.compare.mockResolvedValue(true);
      mocks.findOtp
        .mockResolvedValueOnce({
          id: "otp-a",
          userId: ACTOR_ID,
          hashedOtp: "hashed-otp",
          expiresAt: FUTURE_DATE,
        })
        .mockResolvedValueOnce(null);

      const valid = await verifyOtp(undefined, { otp: OTP_VALUE });
      const replay = await verifyOtp(undefined, { otp: OTP_VALUE });
      expect(valid.errors.message).toBeNull();
      expect(replay.errors.message).toBe("OTP does not exist or has already been used.");
      expect(mocks.deleteOtp).toHaveBeenCalledWith({ where: { id: "otp-a" } });
    });

    it("normalizes login account keys and keeps different accounts independent", async () => {
      mocks.compare.mockResolvedValue(false);
      const loginWith = (email: string) => {
        const formData = new FormData();
        formData.set("email", email);
        formData.set("password", "wrong-password");
        return login(undefined, formData);
      };

      for (const email of [
        " User-A@Example.com ",
        "user-a@example.com",
        "USER-A@EXAMPLE.COM",
        " user-a@example.com",
        "user-a@example.com ",
      ]) {
        expect((await loginWith(email)).errors.message).toBe("Invalid credentials.");
      }

      expect((await loginWith("USER-A@example.com")).errors.message).toBe(RATE_LIMIT_MESSAGE);
      expect((await loginWith("other@example.com")).errors.message).toBe("Invalid credentials.");
      expect(mocks.findUser).toHaveBeenCalledTimes(6);
    });

    it("returns the same login throttle contract for existing and missing accounts", async () => {
      const exhaustLogin = async (user: ReturnType<typeof actor> | null, email: string) => {
        mocks.findUser.mockResolvedValue(user);
        mocks.compare.mockResolvedValue(false);
        let result;
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const formData = new FormData();
          formData.set("email", email);
          formData.set("password", "wrong-password");
          result = await login(undefined, formData);
        }
        return result;
      };

      const existing = await exhaustLogin(actor(), ACTOR_EMAIL);
      clearServerActionRateLimitsForTests();
      const missing = await exhaustLogin(null, "missing@example.com");

      expect(existing?.errors.message).toBe(RATE_LIMIT_MESSAGE);
      expect(missing?.errors.message).toBe(RATE_LIMIT_MESSAGE);
    });

    it("normalizes forgot-password keys while preserving enumeration-safe success", async () => {
      const genericMessage = "If an account with that email exists, we've sent a password reset link.";
      mocks.findUser.mockResolvedValue(actor());

      expect((await forgotPassword(undefined, " User-A@Example.com ")).success.message).toBe(genericMessage);
      expect((await forgotPassword(undefined, ACTOR_EMAIL)).success.message).toBe(genericMessage);
      expect((await forgotPassword(undefined, "USER-A@EXAMPLE.COM")).success.message).toBe(genericMessage);
      expect((await forgotPassword(undefined, ` ${ACTOR_EMAIL} `)).errors.message).toBe(RATE_LIMIT_MESSAGE);
      expect(mocks.sendEmail).toHaveBeenCalledTimes(3);

      clearServerActionRateLimitsForTests();
      mocks.findUser.mockResolvedValue(null);
      const missing = await forgotPassword(undefined, "missing@example.com");
      expect(missing.errors.message).toBeNull();
      expect(missing.success.message).toBe(genericMessage);
    });

    it("limits signup and reset-password work by normalized account or verified subject", async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const formData = new FormData();
        formData.set("name", "User A");
        formData.set("username", `user-a-${attempt}`);
        formData.set("email", attempt === 0 ? " User-A@Example.com " : ACTOR_EMAIL);
        formData.set("password", "password");
        await signup(undefined, formData);
      }
      const signupForm = new FormData();
      signupForm.set("name", "User A");
      signupForm.set("username", "user-a-final");
      signupForm.set("email", "USER-A@EXAMPLE.COM");
      signupForm.set("password", "password");
      expect((await signup(undefined, signupForm)).errors?.message).toBe(RATE_LIMIT_MESSAGE);

      mocks.verifyPasswordResetToken.mockResolvedValue({
        userId: ACTOR_ID,
        expiresAt: FUTURE_DATE.toISOString(),
      });
      mocks.findResetPasswordToken.mockResolvedValue(null);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await resetPassword(undefined, { token: "valid-jwt", newPassword: "replacement" });
      }
      const resetLimited = await resetPassword(undefined, {
        token: "valid-jwt",
        newPassword: "replacement",
      });
      expect(resetLimited.errors.message).toBe(RATE_LIMIT_MESSAGE);
      expect(mocks.findResetPasswordToken).toHaveBeenCalledTimes(5);
    });

    it("limits password guessing and private-key recovery email generation per session user", async () => {
      mocks.compare.mockResolvedValue(false);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await verifyPassword(undefined, { password: "wrong" })).errors.message)
          .toBe("Invalid password. Please try again.");
      }
      expect((await verifyPassword(undefined, { password: "wrong" })).errors.message)
        .toBe(RATE_LIMIT_MESSAGE);
      expect(mocks.compare).toHaveBeenCalledTimes(5);

      clearServerActionRateLimitsForTests();
      mocks.findUser.mockResolvedValue({ ...actor(), oAuthSignup: true });
      const firstEmail = await sendPrivateKeyRecoveryEmail(undefined);
      const repeatedEmail = await sendPrivateKeyRecoveryEmail(undefined);
      expect(firstEmail.errors.message).toBeNull();
      expect(repeatedEmail.errors.message).toBe(RATE_LIMIT_MESSAGE);
      expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    });

    it("preserves one-shot private-key recovery while limiting verification churn by token subject", async () => {
      mocks.verifyPrivateKeyRecoveryToken.mockResolvedValue({
        userId: ACTOR_ID,
        expiresAt: FUTURE_DATE.toISOString(),
      });
      mocks.findPrivateKeyRecoveryToken
        .mockResolvedValueOnce({
          id: "recovery-a",
          userId: ACTOR_ID,
          hashedToken: "hashed-token",
          expiresAt: FUTURE_DATE,
        })
        .mockResolvedValueOnce(null);
      mocks.findUser.mockResolvedValue({
        id: ACTOR_ID,
        privateKey: "encrypted-private-key",
        oAuthSignup: false,
        googleId: null,
      });
      mocks.compare.mockResolvedValue(true);

      const valid = await verifyPrivateKeyRecoveryToken(undefined, { recoveryToken: "valid-token" });
      const replay = await verifyPrivateKeyRecoveryToken(undefined, { recoveryToken: "valid-token" });

      expect(valid.errors.message).toBeNull();
      expect(valid.data).toEqual({
        userId: ACTOR_ID,
        privateKey: "encrypted-private-key",
        recoveryMode: "manual-v1",
      });
      expect(replay.errors.message).toBe("Verification link is invalid or already used.");
      expect(mocks.deletePrivateKeyRecoveryToken).toHaveBeenCalledWith({ where: { id: "recovery-a" } });
    });

    it("throttles search per authenticated user and caps each result query", async () => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        expect((await searchUser(undefined, { username: "friend" })).errors.message).toBeNull();
      }
      expect((await searchUser(undefined, { username: "friend" })).errors.message).toBe(RATE_LIMIT_MESSAGE);
      expect(mocks.findUsers).toHaveBeenCalledTimes(30);
      expect(mocks.findUsers).toHaveBeenLastCalledWith(expect.objectContaining({ take: 20 }));

      mocks.getAuthenticatedSession.mockResolvedValue({ userId: OTHER_USER_ID, token: "session-b" });
      expect((await searchUser(undefined, { username: "friend" })).errors.message).toBeNull();
      expect(mocks.findUsers).toHaveBeenCalledTimes(31);
    });

    it("uses generous per-user limits for FCM token and notification-setting writes", async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        expect((await storeFcmToken(undefined, { fcmToken: `token-${attempt}` })).errors.message).toBeNull();
      }
      expect((await storeFcmToken(undefined, { fcmToken: "token-limited" })).errors.message)
        .toBe(RATE_LIMIT_MESSAGE);

      for (let attempt = 0; attempt < 30; attempt += 1) {
        expect((await updateUserNotificationStatus(undefined, { notificationStatus: true })).errors.message)
          .toBeNull();
      }
      expect((await updateUserNotificationStatus(undefined, { notificationStatus: false })).errors.message)
        .toBe(RATE_LIMIT_MESSAGE);
    });

    it("limits OAuth exchange completion by verified token subject", async () => {
      const originalSecret = process.env.JWT_SECRET;
      process.env.JWT_SECRET = "test-secret";
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      mocks.verifyOAuthExchangeToken.mockResolvedValue({
        userId: ACTOR_ID,
        isNewUser: false,
        tokenType: "oauth_exchange",
      });
      mocks.findUser.mockResolvedValue({ ...actor(), privateKey: null, publicKey: null });

      for (let attempt = 0; attempt < 10; attempt += 1) {
        expect((await verifyOAuthToken(undefined, "exchange-token")).errors.message).toBeNull();
      }
      expect((await verifyOAuthToken(undefined, "exchange-token")).errors.message).toBe(RATE_LIMIT_MESSAGE);
      expect(mocks.findUser).toHaveBeenCalledTimes(10);

      logSpy.mockRestore();
      if (originalSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = originalSecret;
    });

    it("bounds and expires limiter state with a deterministic clock", () => {
      let now = 1_000;
      const limiter = new BoundedInMemoryRateLimiter(2, () => now);
      const policy = { namespace: "bounded-test", limit: 1, windowMs: 1_000 };

      limiter.consume(policy, "raw-account-a@example.com");
      limiter.consume(policy, "raw-account-b@example.com");
      limiter.consume(policy, "raw-account-c@example.com");
      expect(limiter.size).toBe(2);

      now = 2_001;
      expect(limiter.check(policy, "new-account@example.com").allowed).toBe(true);
      expect(limiter.size).toBe(0);
    });
  });
});
