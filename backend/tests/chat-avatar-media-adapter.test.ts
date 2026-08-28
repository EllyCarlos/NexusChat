import { beforeEach, describe, expect, it, vi } from "vitest";

const mediaMocks = vi.hoisted(() => ({
  deleteFilesFromCloudinary: vi.fn(),
  uploadFilesToCloudinary: vi.fn(),
}));

vi.mock("../src/utils/auth.util.js", () => ({
  deleteFilesFromCloudinary: mediaMocks.deleteFilesFromCloudinary,
  uploadFilesToCloudinary: mediaMocks.uploadFilesToCloudinary,
}));

import { createCloudinaryChatAvatarMediaAdapter } from "../src/modules/chats/infrastructure/cloudinary-chat-avatar-media.adapter.js";

const file = {
  path: "temporary-group-avatar",
} as Express.Multer.File;

describe("Cloudinary chat-avatar media adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the bound Multer file to the existing upload helper and maps provider fields", async () => {
    mediaMocks.uploadFilesToCloudinary.mockResolvedValue([{
      public_id: "avatar-public-id",
      secure_url: "https://media.example/avatar.png",
    }]);
    const adapter = createCloudinaryChatAvatarMediaAdapter(file);

    await expect(adapter.uploadAvatar()).resolves.toEqual({
      publicId: "avatar-public-id",
      secureUrl: "https://media.example/avatar.png",
    });
    expect(mediaMocks.uploadFilesToCloudinary).toHaveBeenCalledWith({
      files: [file],
    });
  });

  it("preserves the undefined missing-result signal for application error mapping", async () => {
    mediaMocks.uploadFilesToCloudinary.mockResolvedValue([]);
    const adapter = createCloudinaryChatAvatarMediaAdapter(file);

    await expect(adapter.uploadAvatar()).resolves.toBeUndefined();
  });

  it("delegates deletion of exactly one chat-avatar public ID", async () => {
    mediaMocks.deleteFilesFromCloudinary.mockResolvedValue(undefined);
    const adapter = createCloudinaryChatAvatarMediaAdapter(file);

    await adapter.deleteAvatar("avatar-public-id");

    expect(mediaMocks.deleteFilesFromCloudinary).toHaveBeenCalledWith({
      publicIds: ["avatar-public-id"],
    });
  });
});
