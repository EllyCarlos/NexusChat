import { beforeEach, describe, expect, it, vi } from "vitest";

const mediaMocks = vi.hoisted(() => ({
  deleteFilesFromCloudinary: vi.fn(),
  uploadFilesToCloudinary: vi.fn(),
}));

vi.mock("../src/utils/auth.util.js", () => ({
  deleteFilesFromCloudinary: mediaMocks.deleteFilesFromCloudinary,
  uploadFilesToCloudinary: mediaMocks.uploadFilesToCloudinary,
}));

import { createCloudinaryAttachmentMediaAdapter } from "../src/modules/attachments/infrastructure/cloudinary-attachment-media.adapter.js";

const firstFile = {
  fieldname: "attachments[]",
  path: "temporary/first-attachment",
} as Express.Multer.File;

const secondFile = {
  fieldname: "attachments[]",
  path: "temporary/second-attachment",
} as Express.Multer.File;

describe("Cloudinary attachment media adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes every bound Multer file to the upload helper once and maps only provider-neutral fields", async () => {
    mediaMocks.uploadFilesToCloudinary.mockResolvedValue([
      {
        public_id: "first-public-id",
        secure_url: "https://media.example/first.png",
        providerOnly: "must-not-leak",
      },
      {
        public_id: "second-public-id",
        secure_url: "https://media.example/second.pdf",
        anotherProviderField: 42,
      },
    ]);
    const files = [firstFile, secondFile];
    const adapter = createCloudinaryAttachmentMediaAdapter(files);

    await expect(adapter.uploadAttachments()).resolves.toEqual([
      {
        publicId: "first-public-id",
        secureUrl: "https://media.example/first.png",
      },
      {
        publicId: "second-public-id",
        secureUrl: "https://media.example/second.pdf",
      },
    ]);
    expect(mediaMocks.uploadFilesToCloudinary).toHaveBeenCalledOnce();
    expect(mediaMocks.uploadFilesToCloudinary).toHaveBeenCalledWith({ files });
  });

  it("preserves an empty upload result for application-level count validation", async () => {
    mediaMocks.uploadFilesToCloudinary.mockResolvedValue([]);
    const adapter = createCloudinaryAttachmentMediaAdapter([firstFile]);

    await expect(adapter.uploadAttachments()).resolves.toEqual([]);
  });

  it("delegates deletion with the exact attachment public-ID list", async () => {
    mediaMocks.deleteFilesFromCloudinary.mockResolvedValue(undefined);
    const publicIds = ["first-public-id", "second-public-id"];
    const adapter = createCloudinaryAttachmentMediaAdapter([firstFile, secondFile]);

    await adapter.deleteAttachments(publicIds);

    expect(mediaMocks.deleteFilesFromCloudinary).toHaveBeenCalledOnce();
    expect(mediaMocks.deleteFilesFromCloudinary).toHaveBeenCalledWith({ publicIds });
  });
});
