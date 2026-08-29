import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedIdentity } from "../src/modules/auth/contracts/auth-identity.js";
import { getCurrentUser } from "../src/modules/users/application/get-current-user.js";
import { createUserAvatarUpdater } from "../src/modules/users/application/update-user-avatar.js";
import type { AvatarMediaProvider } from "../src/modules/users/contracts/avatar-media.provider.js";
import type { UserProfileRepository } from "../src/modules/users/contracts/user-profile.repository.js";
import type {
  UpdatedAvatarProfile,
  UploadedAvatar,
} from "../src/modules/users/contracts/user-profile.js";

const USER_ID = "trusted-user-id";
const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");
const UPDATED_AT = new Date("2026-01-02T00:00:00.000Z");

const AUTHENTICATED_IDENTITY = {
  id: USER_ID,
  name: "Trusted User",
  username: "trusted-user",
  avatar: "https://example.test/current-avatar.png",
  email: "trusted@example.test",
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  emailVerified: true,
  publicKey: "public-key",
  needsKeyRecovery: true,
  keyRecoveryCompletedAt: null,
  notificationsEnabled: false,
  verificationBadge: true,
  fcmToken: null,
  oAuthSignup: false,
  avatarCloudinaryPublicId: "internal-avatar-id",
} satisfies AuthenticatedIdentity;

const CURRENT_USER_PROFILE = {
  id: AUTHENTICATED_IDENTITY.id,
  name: AUTHENTICATED_IDENTITY.name,
  username: AUTHENTICATED_IDENTITY.username,
  avatar: AUTHENTICATED_IDENTITY.avatar,
  email: AUTHENTICATED_IDENTITY.email,
  createdAt: AUTHENTICATED_IDENTITY.createdAt,
  updatedAt: AUTHENTICATED_IDENTITY.updatedAt,
  emailVerified: AUTHENTICATED_IDENTITY.emailVerified,
  publicKey: AUTHENTICATED_IDENTITY.publicKey,
  needsKeyRecovery: AUTHENTICATED_IDENTITY.needsKeyRecovery,
  keyRecoveryCompletedAt: AUTHENTICATED_IDENTITY.keyRecoveryCompletedAt,
  notificationsEnabled: AUTHENTICATED_IDENTITY.notificationsEnabled,
  verificationBadge: AUTHENTICATED_IDENTITY.verificationBadge,
  fcmToken: AUTHENTICATED_IDENTITY.fcmToken,
  oAuthSignup: AUTHENTICATED_IDENTITY.oAuthSignup,
};

const UPLOAD_SOURCE = { path: "C:\\safe-test-temp\\avatar-upload" };
const UPLOADED_AVATAR = {
  publicId: "new-avatar-id",
  secureUrl: "https://cloudinary.example/new-avatar",
} satisfies UploadedAvatar;
const UPDATED_PROFILE = {
  id: USER_ID,
  name: "Trusted User",
  username: "trusted-user",
  avatar: UPLOADED_AVATAR.secureUrl,
  email: "trusted@example.test",
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  emailVerified: true,
  publicKey: "public-key",
  notificationsEnabled: false,
  verificationBadge: true,
  fcmToken: null,
  oAuthSignup: false,
} satisfies UpdatedAvatarProfile;

const uploadAvatar = vi.fn();
const deleteAvatar = vi.fn();
const updateAvatar = vi.fn();

const updateUserAvatar = createUserAvatarUpdater({
  avatarMedia: { uploadAvatar, deleteAvatar } as AvatarMediaProvider,
  userRepository: { updateAvatar } as Pick<UserProfileRepository, "updateAvatar">,
});

describe("users current-user application query", () => {
  it("returns the exact safe current-user projection", () => {
    const profile = getCurrentUser(AUTHENTICATED_IDENTITY);

    expect(profile).toEqual(CURRENT_USER_PROFILE);
    expect(profile).not.toBe(AUTHENTICATED_IDENTITY);
    expect(profile).not.toHaveProperty("avatarCloudinaryPublicId");
  });

  it("preserves a missing authenticated identity as null", () => {
    expect(getCurrentUser(undefined)).toBeNull();
  });
});

describe("users avatar application operation", () => {
  beforeEach(() => {
    uploadAvatar.mockReset().mockResolvedValue(UPLOADED_AVATAR);
    deleteAvatar.mockReset().mockResolvedValue(undefined);
    updateAvatar.mockReset().mockResolvedValue(UPDATED_PROFILE);
  });

  it("uploads, persists for the trusted user, then removes the previous avatar", async () => {
    await expect(updateUserAvatar({
      userId: USER_ID,
      existingAvatarPublicId: "old-avatar-id",
      upload: UPLOAD_SOURCE,
    })).resolves.toBe(UPDATED_PROFILE);

    expect(uploadAvatar).toHaveBeenCalledWith(UPLOAD_SOURCE);
    expect(updateAvatar).toHaveBeenCalledWith(USER_ID, {
      avatarUrl: UPLOADED_AVATAR.secureUrl,
      avatarPublicId: UPLOADED_AVATAR.publicId,
    });
    expect(deleteAvatar).toHaveBeenCalledWith("old-avatar-id");
    expect(uploadAvatar.mock.invocationCallOrder[0])
      .toBeLessThan(updateAvatar.mock.invocationCallOrder[0]);
    expect(updateAvatar.mock.invocationCallOrder[0])
      .toBeLessThan(deleteAvatar.mock.invocationCallOrder[0]);
  });

  it("rolls back the uploaded avatar when persistence fails", async () => {
    updateAvatar.mockRejectedValueOnce(new Error("private database detail"));

    await expect(updateUserAvatar({
      userId: USER_ID,
      existingAvatarPublicId: "old-avatar-id",
      upload: UPLOAD_SOURCE,
    })).rejects.toMatchObject({
      code: "USER_AVATAR_UPDATE_FAILED",
      statusCode: 500,
      message: "Failed to update user profile",
    });

    expect(deleteAvatar).toHaveBeenCalledOnce();
    expect(deleteAvatar).toHaveBeenCalledWith(UPLOADED_AVATAR.publicId);
    expect(deleteAvatar).not.toHaveBeenCalledWith("old-avatar-id");
    expect(updateAvatar.mock.invocationCallOrder[0])
      .toBeLessThan(deleteAvatar.mock.invocationCallOrder[0]);
  });

  it("does not persist or delete when the provider upload fails", async () => {
    uploadAvatar.mockRejectedValueOnce(new Error("private provider detail"));

    await expect(updateUserAvatar({
      userId: USER_ID,
      existingAvatarPublicId: "old-avatar-id",
      upload: UPLOAD_SOURCE,
    })).rejects.toMatchObject({
      code: "USER_AVATAR_UPDATE_FAILED",
      statusCode: 500,
      message: "Failed to update user profile",
    });

    expect(updateAvatar).not.toHaveBeenCalled();
    expect(deleteAvatar).not.toHaveBeenCalled();
  });

  it("keeps the committed profile when previous-avatar deletion fails and sanitizes the log", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    deleteAvatar.mockRejectedValueOnce(new Error("private previous-avatar detail"));

    await expect(updateUserAvatar({
      userId: USER_ID,
      existingAvatarPublicId: "old-avatar-id",
      upload: UPLOAD_SOURCE,
    })).resolves.toBe(UPDATED_PROFILE);

    expect(updateAvatar).toHaveBeenCalledOnce();
    expect(deleteAvatar).toHaveBeenCalledWith("old-avatar-id");
    expect(errorLog).toHaveBeenCalledWith(
      "Previous avatar cleanup failed.",
      { errorType: "Error" },
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("private previous-avatar detail");
    errorLog.mockRestore();
  });

  it.each([
    ["an omitted", undefined],
    ["a null", null],
    ["an empty", ""],
    ["an unchanged", UPLOADED_AVATAR.publicId],
  ])("skips deletion for %s previous-avatar ID", async (_label, existingAvatarPublicId) => {
    await expect(updateUserAvatar({
      userId: USER_ID,
      existingAvatarPublicId,
      upload: UPLOAD_SOURCE,
    })).resolves.toBe(UPDATED_PROFILE);

    expect(updateAvatar).toHaveBeenCalledOnce();
    expect(deleteAvatar).not.toHaveBeenCalled();
  });

  it("preserves the generic update error when uploaded-avatar rollback also fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    updateAvatar.mockRejectedValueOnce(new Error("private database detail"));
    deleteAvatar.mockRejectedValueOnce(new Error("private rollback detail"));

    await expect(updateUserAvatar({
      userId: USER_ID,
      existingAvatarPublicId: "old-avatar-id",
      upload: UPLOAD_SOURCE,
    })).rejects.toMatchObject({
      code: "USER_AVATAR_UPDATE_FAILED",
      statusCode: 500,
      message: "Failed to update user profile",
    });

    expect(deleteAvatar).toHaveBeenCalledOnce();
    expect(deleteAvatar).toHaveBeenCalledWith(UPLOADED_AVATAR.publicId);
    expect(errorLog).toHaveBeenCalledWith(
      "Uploaded-file cleanup failed.",
      { errorType: "Error" },
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("private database detail");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("private rollback detail");
    errorLog.mockRestore();
  });
});
