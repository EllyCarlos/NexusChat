import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApplicationError } from "../src/errors/application-error.js";
import { createKeyRecoveryCompleter } from "../src/modules/users/application/complete-key-recovery.js";
import { createNotificationTokenUpdater } from "../src/modules/users/application/update-notification-token.js";
import type { UserProfileRepository } from "../src/modules/users/contracts/user-profile.repository.js";

const TRUSTED_USER_ID = "trusted-session-user";
const FIXED_COMPLETION_TIME = new Date("2026-08-27T08:15:00.000Z");

const publicErrorShape = (error: unknown) => {
  expect(error).toBeInstanceOf(ApplicationError);
  const applicationError = error as ApplicationError;
  return {
    name: applicationError.name,
    code: applicationError.code,
    message: applicationError.message,
    statusCode: applicationError.statusCode,
    cause: (applicationError as Error & { cause?: unknown }).cause,
  };
};

describe("users state application operations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("notification-token update", () => {
    it("updates the trusted user and returns the exact repository result", async () => {
      const repositoryResult = { fcmToken: "opaque-registration-token" };
      const updateNotificationToken = vi.fn<UserProfileRepository["updateNotificationToken"]>()
        .mockResolvedValueOnce(repositoryResult);
      const operation = createNotificationTokenUpdater({
        userRepository: { updateNotificationToken },
      });
      const input = {
        userId: TRUSTED_USER_ID,
        fcmToken: repositoryResult.fcmToken,
        targetUserId: "body-controlled-user",
      };

      await expect(operation(input)).resolves.toBe(repositoryResult);
      expect(updateNotificationToken).toHaveBeenCalledOnce();
      expect(updateNotificationToken).toHaveBeenCalledWith(
        TRUSTED_USER_ID,
        repositoryResult.fcmToken,
      );
    });

    it("preserves a whitespace-only token as an ordinary application input", async () => {
      const whitespaceToken = "   ";
      const repositoryResult = { fcmToken: whitespaceToken };
      const updateNotificationToken = vi.fn<UserProfileRepository["updateNotificationToken"]>()
        .mockResolvedValueOnce(repositoryResult);
      const operation = createNotificationTokenUpdater({
        userRepository: { updateNotificationToken },
      });

      await expect(operation({
        userId: TRUSTED_USER_ID,
        fcmToken: whitespaceToken,
      })).resolves.toBe(repositoryResult);
      expect(updateNotificationToken).toHaveBeenCalledWith(
        TRUSTED_USER_ID,
        whitespaceToken,
      );
    });

    it("sanitizes repository failures without logging token or database details", async () => {
      const rawToken = "opaque-private-registration-token";
      const rawFailure = `database rejected ${rawToken}`;
      const updateNotificationToken = vi.fn<UserProfileRepository["updateNotificationToken"]>()
        .mockRejectedValueOnce(new Error(rawFailure));
      const operation = createNotificationTokenUpdater({
        userRepository: { updateNotificationToken },
      });
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const thrown = await operation({
        userId: TRUSTED_USER_ID,
        fcmToken: rawToken,
      }).catch((error: unknown) => error);

      const shape = publicErrorShape(thrown);
      expect(shape).toEqual({
        name: "ApplicationError",
        code: "USER_NOTIFICATION_TOKEN_UPDATE_FAILED",
        message: "Internal server error",
        statusCode: 500,
        cause: undefined,
      });
      expect(String(thrown)).not.toContain(rawToken);
      expect(String(thrown)).not.toContain(rawFailure);
      expect(JSON.stringify(shape)).not.toContain(rawToken);
      expect(JSON.stringify(shape)).not.toContain("database rejected");
      expect(errorLog).not.toHaveBeenCalled();
    });
  });

  describe("key-recovery completion", () => {
    it("uses the trusted user and fixed clock and returns the exact repository result", async () => {
      const repositoryResult = {
        id: TRUSTED_USER_ID,
        needsKeyRecovery: false,
        keyRecoveryCompletedAt: FIXED_COMPLETION_TIME,
      };
      const completeKeyRecovery = vi.fn<UserProfileRepository["completeKeyRecovery"]>()
        .mockResolvedValueOnce(repositoryResult);
      const now = vi.fn(() => FIXED_COMPLETION_TIME);
      const operation = createKeyRecoveryCompleter({
        userRepository: { completeKeyRecovery },
        now,
      });
      const input = {
        userId: TRUSTED_USER_ID,
        targetUserId: "body-controlled-user",
      };

      await expect(operation(input)).resolves.toBe(repositoryResult);
      expect(now).toHaveBeenCalledOnce();
      expect(completeKeyRecovery).toHaveBeenCalledOnce();
      expect(completeKeyRecovery).toHaveBeenCalledWith(
        TRUSTED_USER_ID,
        FIXED_COMPLETION_TIME,
      );
    });

    it("sanitizes repository failures without logging recovery or database details", async () => {
      const rawFailure = "database exposed private recovery state";
      const completeKeyRecovery = vi.fn<UserProfileRepository["completeKeyRecovery"]>()
        .mockRejectedValueOnce(new Error(rawFailure));
      const now = vi.fn(() => FIXED_COMPLETION_TIME);
      const operation = createKeyRecoveryCompleter({
        userRepository: { completeKeyRecovery },
        now,
      });
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const thrown = await operation({ userId: TRUSTED_USER_ID })
        .catch((error: unknown) => error);

      const shape = publicErrorShape(thrown);
      expect(shape).toEqual({
        name: "ApplicationError",
        code: "USER_KEY_RECOVERY_STATE_UPDATE_FAILED",
        message: "Failed to complete private key recovery.",
        statusCode: 500,
        cause: undefined,
      });
      expect(String(thrown)).not.toContain(rawFailure);
      expect(JSON.stringify(shape)).not.toContain("private recovery state");
      expect(JSON.stringify(shape)).not.toContain("database exposed");
      expect(errorLog).not.toHaveBeenCalled();
    });
  });
});
