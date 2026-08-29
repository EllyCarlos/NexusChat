import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: { user: { update: mocks.update } },
}));

import {
  KEY_RECOVERY_STATE_SELECT,
  NOTIFICATION_TOKEN_SELECT,
  prismaUserProfileRepository,
  UPDATED_AVATAR_PROFILE_SELECT,
} from "../src/modules/users/infrastructure/prisma-user-profile.repository.js";

const expectSecretFieldsOmitted = (select: Record<string, unknown>) => {
  expect(select).not.toHaveProperty("hashedPassword");
  expect(select).not.toHaveProperty("privateKey");
  expect(select).not.toHaveProperty("avatarCloudinaryPublicId");
};

describe("Prisma user profile repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates an avatar with the exact data and safe profile projection", async () => {
    const profile = {
      id: "avatar-user",
      name: "Avatar User",
      username: "avatar-user",
      avatar: "https://media.example/new-avatar.png",
      email: "avatar@example.test",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      emailVerified: true,
      publicKey: null,
      notificationsEnabled: true,
      verificationBadge: false,
      fcmToken: null,
      oAuthSignup: false,
    };
    mocks.update.mockResolvedValueOnce(profile);

    await expect(prismaUserProfileRepository.updateAvatar(profile.id, {
      avatarUrl: profile.avatar,
      avatarPublicId: "new-avatar-public-id",
    })).resolves.toBe(profile);

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: profile.id },
      data: {
        avatar: profile.avatar,
        avatarCloudinaryPublicId: "new-avatar-public-id",
      },
      select: UPDATED_AVATAR_PROFILE_SELECT,
    });
    expect(UPDATED_AVATAR_PROFILE_SELECT).toEqual({
      id: true,
      name: true,
      username: true,
      avatar: true,
      email: true,
      createdAt: true,
      updatedAt: true,
      emailVerified: true,
      publicKey: true,
      notificationsEnabled: true,
      verificationBadge: true,
      fcmToken: true,
      oAuthSignup: true,
    });
    expectSecretFieldsOmitted(UPDATED_AVATAR_PROFILE_SELECT);
  });

  it("updates only the notification token with the exact safe projection", async () => {
    const state = { fcmToken: "opaque-registration-token" };
    mocks.update.mockResolvedValueOnce(state);

    await expect(prismaUserProfileRepository.updateNotificationToken(
      "notification-user",
      state.fcmToken,
    )).resolves.toBe(state);

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "notification-user" },
      data: { fcmToken: state.fcmToken },
      select: NOTIFICATION_TOKEN_SELECT,
    });
    expect(NOTIFICATION_TOKEN_SELECT).toEqual({ fcmToken: true });
    expectSecretFieldsOmitted(NOTIFICATION_TOKEN_SELECT);
  });

  it("completes key recovery with the exact state update and safe projection", async () => {
    const completedAt = new Date("2026-02-03T04:05:06.000Z");
    const state = {
      id: "recovery-user",
      needsKeyRecovery: false,
      keyRecoveryCompletedAt: completedAt,
    };
    mocks.update.mockResolvedValueOnce(state);

    await expect(prismaUserProfileRepository.completeKeyRecovery(
      state.id,
      completedAt,
    )).resolves.toBe(state);

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: state.id },
      data: {
        needsKeyRecovery: false,
        keyRecoveryCompletedAt: completedAt,
      },
      select: KEY_RECOVERY_STATE_SELECT,
    });
    expect(KEY_RECOVERY_STATE_SELECT).toEqual({
      id: true,
      needsKeyRecovery: true,
      keyRecoveryCompletedAt: true,
    });
    expectSecretFieldsOmitted(KEY_RECOVERY_STATE_SELECT);
  });

  it.each([
    [
      "avatar update",
      () => prismaUserProfileRepository.updateAvatar("avatar-user", {
        avatarUrl: "https://media.example/new-avatar.png",
        avatarPublicId: "new-avatar-public-id",
      }),
    ],
    [
      "notification-token update",
      () => prismaUserProfileRepository.updateNotificationToken(
        "notification-user",
        "opaque-registration-token",
      ),
    ],
    [
      "recovery-state update",
      () => prismaUserProfileRepository.completeKeyRecovery(
        "recovery-user",
        new Date("2026-02-03T04:05:06.000Z"),
      ),
    ],
  ])("propagates the original Prisma rejection for %s", async (_label, invoke) => {
    const failure = new Error("private Prisma failure detail");
    mocks.update.mockRejectedValueOnce(failure);

    await expect(invoke()).rejects.toBe(failure);
  });
});
