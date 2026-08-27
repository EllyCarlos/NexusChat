import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cloudinaryUpload: vi.fn(),
  cloudinaryDestroy: vi.fn(),
  userUpdate: vi.fn(),
  chatFindFirst: vi.fn(),
  chatUpdate: vi.fn(),
  messageCreate: vi.fn(),
  unreadUpsert: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("cloudinary", () => ({
  v2: {
    uploader: {
      upload: mocks.cloudinaryUpload,
      destroy: mocks.cloudinaryDestroy,
    },
  },
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    user: { update: mocks.userUpdate },
    chat: {
      findFirst: mocks.chatFindFirst,
      update: mocks.chatUpdate,
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    chatMembers: { createMany: vi.fn() },
    message: { create: mocks.messageCreate },
    unreadMessages: { upsert: mocks.unreadUpsert },
    $transaction: mocks.transaction,
  },
}));

vi.mock("../src/utils/chat.util.js", () => ({
  disconnectMembersFromChatRoom: vi.fn(),
  joinMembersInChatRoom: vi.fn(),
}));

vi.mock("../src/utils/socket.util.js", () => ({
  emitEvent: vi.fn(),
  emitEventToRoom: vi.fn(),
}));

vi.mock("../src/utils/generic.js", () => ({
  calculateSkip: (page: number, limit: number) => (page - 1) * limit,
  convertBufferToBase64: vi.fn(),
  sendPushNotification: vi.fn(),
}));

vi.mock("../src/utils/email.util.js", () => ({ sendMail: vi.fn() }));
vi.mock("../src/utils/jwt.utils.js", () => ({ signPasswordResetToken: vi.fn() }));
vi.mock("../src/config/env.config.js", async () => {
  const { tmpdir: getTempDirectory } = await import("node:os");
  const { join: joinPath } = await import("node:path");
  return {
    config: {
      app: { frontendUrl: "https://nexuswebapp.vercel.app" },
      upload: {
        tempDirectory: joinPath(
          getTempDirectory(),
          `nexuschat-upload-tests-${process.pid}`,
        ),
      },
    },
  };
});

import { uploadAttachment } from "../src/controllers/attachment.controller.js";
import { createChat, updateChat } from "../src/controllers/chat.controller.js";
import { updateUser } from "../src/controllers/user.controller.js";
import { MAX_FILE_SIZE } from "../src/constants/file.constant.js";
import { errorMiddleware } from "../src/middlewares/error.middleware.js";
import {
  attachmentFileValidation,
  fileValidation,
} from "../src/middlewares/file-validation.middleware.js";
import {
  attachmentUpload,
  avatarUpload,
  createChatUpload,
} from "../src/middlewares/multer.middleware.js";
import { avatarUploadRateLimit } from "../src/middlewares/rate-limit.middleware.js";
import { clearBackendRateLimitsForTests, RATE_LIMIT_MESSAGE } from "../src/security/rate-limit.js";
import { uploadFilesToCloudinary } from "../src/utils/auth.util.js";
import { uploadCleanupBoundary } from "../src/utils/upload-lifecycle.util.js";
import type { AuthenticatedRequest } from "../src/interfaces/auth/auth.interface.js";

const TEST_TEMP_DIRECTORY = join(tmpdir(), `nexuschat-upload-tests-${process.pid}`);
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const PDF_BYTES = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF", "utf8");
const GIF_BYTES = Buffer.from("GIF89a\u0001\u0000\u0001\u0000", "binary");
const ACTOR_ID = "upload-user-a";
const CHAT_ID = "chat-a";

const resetTempDirectory = async () => {
  await rm(TEST_TEMP_DIRECTORY, { recursive: true, force: true });
  await mkdir(TEST_TEMP_DIRECTORY, { recursive: true });
};

const tempFiles = async () => readdir(TEST_TEMP_DIRECTORY);

const authenticated = (req: Request, _res: Response, next: NextFunction) => {
  (req as AuthenticatedRequest).user = {
    id: req.get("x-test-user") || ACTOR_ID,
    name: "Upload User",
    email: "upload@example.com",
    username: "upload-user",
  } as AuthenticatedRequest["user"];
  next();
};

const createMultipartApp = () => {
  const app = express();
  const avatarProviderWork = vi.fn((req: Request, res: Response) => {
    res.status(200).json({ filename: req.file?.filename, path: req.file?.path });
  });
  const attachmentProviderWork = vi.fn((_req: Request, res: Response) => res.status(204).send());
  const attachmentAuthorization = vi.fn((req: Request, _res: Response, next: NextFunction) => {
    if (!req.params.chatId) {
      next(new Error("missing path authorization target"));
      return;
    }
    next();
  });

  app.patch(
    "/avatar",
    authenticated,
    uploadCleanupBoundary,
    avatarUpload.single("avatar"),
    fileValidation,
    avatarProviderWork,
  );
  app.patch(
    "/rate-avatar",
    authenticated,
    avatarUploadRateLimit,
    uploadCleanupBoundary,
    avatarUpload.single("avatar"),
    fileValidation,
    avatarProviderWork,
  );
  app.post(
    "/chat-avatar",
    authenticated,
    uploadCleanupBoundary,
    createChatUpload.single("avatar"),
    fileValidation,
    avatarProviderWork,
  );
  app.post(
    "/attachment/:chatId",
    authenticated,
    attachmentAuthorization,
    uploadCleanupBoundary,
    attachmentUpload.array("attachments[]", 5),
    attachmentFileValidation,
    attachmentProviderWork,
  );
  app.use(errorMiddleware);

  return { app, attachmentAuthorization, attachmentProviderWork, avatarProviderWork };
};

const responseMock = () => {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response;
};

const createTempMulterFile = async (
  label: string,
  content: Buffer = PNG_BYTES,
): Promise<Express.Multer.File> => {
  const path = join(TEST_TEMP_DIRECTORY, `${label}-${crypto.randomUUID()}`);
  await writeFile(path, content);
  return {
    fieldname: "avatar",
    originalname: `${label}.png`,
    encoding: "7bit",
    mimetype: "image/png",
    size: content.length,
    destination: TEST_TEMP_DIRECTORY,
    filename: basename(path),
    path,
    stream: null as never,
  };
};

const authorizedChat = () => ({
  id: CHAT_ID,
  isGroupChat: true,
  adminId: ACTOR_ID,
  avatarCloudinaryPublicId: "old-avatar-id",
  ChatMembers: [{ userId: ACTOR_ID }],
});

beforeAll(async () => {
  await resetTempDirectory();
});

beforeEach(async () => {
  vi.clearAllMocks();
  clearBackendRateLimitsForTests();
  await resetTempDirectory();
  mocks.cloudinaryUpload.mockResolvedValue({
    public_id: "new-avatar-id",
    secure_url: "https://cloudinary.example/new-avatar",
  });
  mocks.cloudinaryDestroy.mockResolvedValue({ result: "ok" });
  mocks.chatFindFirst.mockResolvedValue(authorizedChat());
  mocks.chatUpdate.mockResolvedValue({ id: CHAT_ID, name: "Group", avatar: "new-avatar" });
  mocks.userUpdate.mockResolvedValue({
    id: ACTOR_ID,
    name: "Upload User",
    username: "upload-user",
    avatar: "https://cloudinary.example/new-avatar",
    email: "upload@example.com",
    createdAt: new Date(),
    updatedAt: new Date(),
    emailVerified: true,
    publicKey: null,
    notificationsEnabled: true,
    verificationBadge: false,
    fcmToken: null,
    oAuthSignup: false,
  });
  mocks.messageCreate.mockResolvedValue({
    id: "message-a",
    attachments: [{ secureUrl: "https://cloudinary.example/attachment" }],
    createdAt: new Date(),
    sender: { id: ACTOR_ID, username: "upload-user", avatar: "avatar" },
  });
});

afterAll(async () => {
  await rm(TEST_TEMP_DIRECTORY, { recursive: true, force: true });
});

describe("multipart signature validation and parsing limits", () => {
  it("accepts a valid avatar image by detected signature", async () => {
    const { app, avatarProviderWork } = createMultipartApp();
    const result = await request(app)
      .patch("/avatar")
      .attach("avatar", PNG_BYTES, { filename: "avatar.png", contentType: "image/png" });

    expect(result.status).toBe(200);
    expect(avatarProviderWork).toHaveBeenCalledOnce();
    await vi.waitFor(async () => expect(await tempFiles()).toEqual([]));
  });

  it("rejects a spoofed JPEG claim containing invalid content", async () => {
    const { app, avatarProviderWork } = createMultipartApp();
    const result = await request(app)
      .patch("/avatar")
      .attach("avatar", Buffer.from("not-a-jpeg"), { filename: "spoof.jpg", contentType: "image/jpeg" });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ success: false, message: "Unsupported or invalid file type" });
    expect(avatarProviderWork).not.toHaveBeenCalled();
    expect(JSON.stringify(result.body)).not.toContain(TEST_TEMP_DIRECTORY);
    expect(JSON.stringify(result.body)).not.toContain("spoof.jpg");
    await vi.waitFor(async () => expect(await tempFiles()).toEqual([]));
  });

  it("accepts a supported PDF attachment by detected signature", async () => {
    const { app, attachmentProviderWork } = createMultipartApp();
    const result = await request(app)
      .post(`/attachment/${CHAT_ID}`)
      .attach("attachments[]", PDF_BYTES, { filename: "document.pdf", contentType: "application/pdf" });

    expect(result.status).toBe(204);
    expect(attachmentProviderWork).toHaveBeenCalledOnce();
    await vi.waitFor(async () => expect(await tempFiles()).toEqual([]));
  });

  it("rejects an unsupported detected signature even when the claimed MIME is allowed", async () => {
    const { app, attachmentProviderWork } = createMultipartApp();
    const result = await request(app)
      .post(`/attachment/${CHAT_ID}`)
      .attach("attachments[]", GIF_BYTES, { filename: "spoof.png", contentType: "image/png" });

    expect(result.status).toBe(400);
    expect(result.body.message).toBe("Unsupported or invalid file type");
    expect(attachmentProviderWork).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect(await tempFiles()).toEqual([]));
  });

  it("returns 413 for a file larger than five MiB and leaves no residue", async () => {
    const { app, avatarProviderWork } = createMultipartApp();
    const result = await request(app)
      .patch("/avatar")
      .attach("avatar", Buffer.alloc(MAX_FILE_SIZE + 1, 1), { filename: "large.png", contentType: "image/png" });

    expect(result.status).toBe(413);
    expect(result.body).toEqual({ success: false, message: "File is too large" });
    expect(avatarProviderWork).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect(await tempFiles()).toEqual([]));
  });

  it("rejects more than five attachment files before provider work", async () => {
    const { app, attachmentProviderWork } = createMultipartApp();
    let uploadRequest = request(app).post(`/attachment/${CHAT_ID}`);
    for (let index = 0; index < 6; index += 1) {
      uploadRequest = uploadRequest.attach(
        "attachments[]",
        PNG_BYTES,
        { filename: `${index}.png`, contentType: "image/png" },
      );
    }
    const result = await uploadRequest;

    expect(result.status).toBe(400);
    expect(attachmentProviderWork).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect(await tempFiles()).toEqual([]));
  });

  it("rejects excessive multipart fields or parts", async () => {
    const { app, avatarProviderWork } = createMultipartApp();
    const result = await request(app)
      .patch("/avatar")
      .field("unexpected", "value")
      .attach("avatar", PNG_BYTES, { filename: "avatar.png", contentType: "image/png" });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ success: false, message: "Invalid multipart request" });
    expect(avatarProviderWork).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect(await tempFiles()).toEqual([]));
  });

  it("rejects an oversized multipart field and cleans any written file", async () => {
    const { app, avatarProviderWork } = createMultipartApp();
    const result = await request(app)
      .post("/chat-avatar")
      .attach("avatar", PNG_BYTES, { filename: "avatar.png", contentType: "image/png" })
      .field("name", "x".repeat(64 * 1024 + 1));

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ success: false, message: "Invalid multipart request" });
    expect(avatarProviderWork).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect(await tempFiles()).toEqual([]));
  });

  it("rejects an unexpected file field safely", async () => {
    const { app, avatarProviderWork } = createMultipartApp();
    const result = await request(app)
      .patch("/avatar")
      .attach("unexpected", PNG_BYTES, { filename: "avatar.png", contentType: "image/png" });

    expect(result.status).toBe(400);
    expect(result.body.message).toBe("Unexpected file field or too many files");
    expect(avatarProviderWork).not.toHaveBeenCalled();
  });

  it("never uses an unsafe or long original filename as the local path", async () => {
    const { app } = createMultipartApp();
    const maliciousName = `../../${"a".repeat(300)}.png`;
    const result = await request(app)
      .patch("/avatar")
      .attach("avatar", PNG_BYTES, { filename: maliciousName, contentType: "image/png" });

    expect(result.status).toBe(200);
    expect(result.body.filename).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.body.filename).not.toContain("a".repeat(20));
    expect(basename(result.body.path)).toBe(result.body.filename);
    expect(result.body.path).toContain(TEST_TEMP_DIRECTORY);
    await vi.waitFor(async () => expect(await tempFiles()).toEqual([]));
  });

  it("authorizes attachments from the path before Multer without relying on field order", async () => {
    const { app, attachmentAuthorization, attachmentProviderWork } = createMultipartApp();
    const result = await request(app)
      .post(`/attachment/${CHAT_ID}`)
      .attach("attachments[]", PNG_BYTES, { filename: "image.png", contentType: "image/png" });

    expect(result.status).toBe(204);
    expect(attachmentAuthorization).toHaveBeenCalledOnce();
    expect(attachmentAuthorization.mock.calls[0]?.[0].params.chatId).toBe(CHAT_ID);
    expect(attachmentAuthorization.mock.invocationCallOrder[0])
      .toBeLessThan(attachmentProviderWork.mock.invocationCallOrder[0]);
  });

  it("returns safe 400 for a truncated multipart body and removes partial files", async () => {
    const { app, avatarProviderWork } = createMultipartApp();
    const boundary = "nexuschat-truncated-boundary";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="partial.png"\r\nContent-Type: image/png\r\n\r\n`),
      PNG_BYTES,
    ]);
    const result = await request(app)
      .patch("/avatar")
      .set("Content-Type", `multipart/form-data; boundary=${boundary}`)
      .send(body);

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ success: false, message: "Invalid multipart request" });
    expect(avatarProviderWork).not.toHaveBeenCalled();
    expect(JSON.stringify(result.body)).not.toContain(TEST_TEMP_DIRECTORY);
    await vi.waitFor(async () => expect(await tempFiles()).toEqual([]));
  });

  it("keeps the existing upload limit ahead of disk and provider work", async () => {
    const { app, avatarProviderWork } = createMultipartApp();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const allowed = await request(app)
        .patch("/rate-avatar")
        .attach("avatar", PNG_BYTES, { filename: `${attempt}.png`, contentType: "image/png" });
      expect(allowed.status).toBe(200);
    }

    const limited = await request(app)
      .patch("/rate-avatar")
      .attach("avatar", PNG_BYTES, { filename: "limited.png", contentType: "image/png" });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ success: false, message: RATE_LIMIT_MESSAGE });
    expect(avatarProviderWork).toHaveBeenCalledTimes(10);
    await vi.waitFor(async () => expect(await tempFiles()).toEqual([]));
  });
});

describe("Cloudinary compensation and avatar replacement ordering", () => {
  it("rolls back the first remote upload when the second upload fails", async () => {
    mocks.cloudinaryUpload
      .mockResolvedValueOnce({ public_id: "first-id", secure_url: "https://cloudinary.example/first" })
      .mockRejectedValueOnce(new Error("provider upload details"));
    const files = [
      { path: "first-temp" } as Express.Multer.File,
      { path: "second-temp" } as Express.Multer.File,
    ];

    await expect(uploadFilesToCloudinary({ files })).rejects.toThrow("provider upload details");
    expect(mocks.cloudinaryDestroy).toHaveBeenCalledWith("first-id", { resource_type: "image" });
    expect(mocks.cloudinaryDestroy).toHaveBeenCalledTimes(1);
  });

  it("destroys every new attachment when database persistence fails", async () => {
    const first = await createTempMulterFile("first");
    const second = await createTempMulterFile("second");
    mocks.cloudinaryUpload
      .mockResolvedValueOnce({ public_id: "first-id", secure_url: "https://cloudinary.example/first" })
      .mockResolvedValueOnce({ public_id: "second-id", secure_url: "https://cloudinary.example/second" });
    mocks.messageCreate.mockRejectedValue(new Error("database internals"));
    const next = vi.fn();
    const req = {
      user: { id: ACTOR_ID },
      params: { chatId: CHAT_ID },
      files: [first, second],
      app: { get: vi.fn(() => ({})) },
    } as unknown as AuthenticatedRequest;

    await uploadAttachment(req, responseMock(), next as NextFunction);

    expect(mocks.cloudinaryDestroy).toHaveBeenCalledWith("first-id", { resource_type: "image" });
    expect(mocks.cloudinaryDestroy).toHaveBeenCalledWith("second-id", { resource_type: "image" });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 500,
      message: "Failed to upload attachments",
    }));
    expect(existsSync(first.path)).toBe(false);
    expect(existsSync(second.path)).toBe(false);
  });

  it("rolls back a new group avatar when transactional chat creation fails", async () => {
    const file = await createTempMulterFile("group-create-db-failure");
    mocks.transaction.mockRejectedValue(new Error("transaction failure"));
    const next = vi.fn();
    const req = {
      user: { id: ACTOR_ID },
      body: { isGroupChat: "true", members: ["member-a", "member-b"], name: "Group" },
      file,
      app: { get: vi.fn(() => ({})) },
    } as unknown as AuthenticatedRequest;

    await createChat(req, responseMock(), next as NextFunction);

    expect(mocks.cloudinaryDestroy).toHaveBeenCalledWith("new-avatar-id", { resource_type: "image" });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 500,
      message: "Failed to create group chat",
    }));
    expect(existsSync(file.path)).toBe(false);
  });

  it("uploads and commits a new group avatar before deleting the old avatar", async () => {
    const file = await createTempMulterFile("group-success");
    const next = vi.fn();
    const req = {
      user: { id: ACTOR_ID },
      params: { id: CHAT_ID },
      body: {},
      file,
      app: { get: vi.fn(() => ({})) },
    } as unknown as AuthenticatedRequest;
    const res = responseMock();

    await updateChat(req, res, next as NextFunction);

    expect(mocks.cloudinaryUpload.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.chatUpdate.mock.invocationCallOrder[0]);
    expect(mocks.chatUpdate.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.cloudinaryDestroy.mock.invocationCallOrder[0]);
    expect(mocks.cloudinaryDestroy).toHaveBeenCalledWith("old-avatar-id", { resource_type: "image" });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
    expect(existsSync(file.path)).toBe(false);
  });

  it("leaves the old avatar untouched and deletes the temp file when the new upload fails", async () => {
    const file = await createTempMulterFile("group-upload-failure");
    mocks.cloudinaryUpload.mockRejectedValue(new Error("provider secret"));
    const next = vi.fn();
    const req = {
      user: { id: ACTOR_ID },
      params: { id: CHAT_ID },
      body: {},
      file,
      app: { get: vi.fn(() => ({})) },
    } as unknown as AuthenticatedRequest;

    await updateChat(req, responseMock(), next as NextFunction);

    expect(mocks.chatUpdate).not.toHaveBeenCalled();
    expect(mocks.cloudinaryDestroy).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 500,
      message: "Failed to update chat",
    }));
    expect(JSON.stringify(next.mock.calls[0]?.[0])).not.toContain(TEST_TEMP_DIRECTORY);
    expect(JSON.stringify(next.mock.calls[0]?.[0])).not.toContain("provider secret");
    expect(existsSync(file.path)).toBe(false);
  });

  it("rolls back the new group avatar and cleans temp state when the DB update fails", async () => {
    const file = await createTempMulterFile("group-db-failure");
    mocks.chatUpdate.mockRejectedValue(new Error("database internals"));
    const next = vi.fn();
    const req = {
      user: { id: ACTOR_ID },
      params: { id: CHAT_ID },
      body: {},
      file,
      app: { get: vi.fn(() => ({})) },
    } as unknown as AuthenticatedRequest;

    await updateChat(req, responseMock(), next as NextFunction);

    expect(mocks.cloudinaryDestroy).toHaveBeenCalledWith("new-avatar-id", { resource_type: "image" });
    expect(mocks.cloudinaryDestroy).not.toHaveBeenCalledWith("old-avatar-id", { resource_type: "image" });
    expect(existsSync(file.path)).toBe(false);
  });

  it("keeps the newly committed avatar when old-asset cleanup fails", async () => {
    const file = await createTempMulterFile("old-cleanup-failure");
    mocks.cloudinaryDestroy.mockRejectedValue(new Error("old provider cleanup details"));
    const next = vi.fn();
    const req = {
      user: { id: ACTOR_ID },
      params: { id: CHAT_ID },
      body: {},
      file,
      app: { get: vi.fn(() => ({})) },
    } as unknown as AuthenticatedRequest;
    const res = responseMock();

    await updateChat(req, res, next as NextFunction);

    expect(mocks.chatUpdate).toHaveBeenCalledOnce();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
    expect(existsSync(file.path)).toBe(false);
  });

  it("cleans a user-avatar temp file after successful upload", async () => {
    const file = await createTempMulterFile("user-avatar");
    const req = {
      user: { id: ACTOR_ID, avatarCloudinaryPublicId: "old-user-avatar" },
      body: { userId: "body-controlled-user-id" },
      params: { id: "path-controlled-user-id" },
      file,
    } as unknown as AuthenticatedRequest;
    const res = responseMock();
    const next = vi.fn();

    await updateUser(req, res, next as NextFunction);

    expect(mocks.cloudinaryUpload.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.userUpdate.mock.invocationCallOrder[0]);
    expect(mocks.userUpdate.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.cloudinaryDestroy.mock.invocationCallOrder[0]);
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ACTOR_ID },
      data: {
        avatar: "https://cloudinary.example/new-avatar",
        avatarCloudinaryPublicId: "new-avatar-id",
      },
    }));
    const responseBody = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(responseBody).toEqual({
      id: ACTOR_ID,
      name: "Upload User",
      username: "upload-user",
      avatar: "https://cloudinary.example/new-avatar",
      email: "upload@example.com",
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
      emailVerified: true,
      publicKey: null,
      notificationsEnabled: true,
      verificationBadge: false,
      fcmToken: null,
      oAuthSignup: false,
    });
    expect(responseBody).not.toHaveProperty("avatarCloudinaryPublicId");
    expect(responseBody).not.toHaveProperty("hashedPassword");
    expect(responseBody).not.toHaveProperty("privateKey");
    expect(existsSync(file.path)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("rolls back a user avatar when database persistence fails", async () => {
    const file = await createTempMulterFile("user-avatar-db-failure");
    mocks.userUpdate.mockRejectedValueOnce(new Error("private database detail"));
    const next = vi.fn();

    await updateUser({
      user: { id: ACTOR_ID, avatarCloudinaryPublicId: "old-user-avatar" },
      file,
    } as unknown as AuthenticatedRequest, responseMock(), next as NextFunction);

    expect(mocks.cloudinaryDestroy).toHaveBeenCalledWith(
      "new-avatar-id",
      { resource_type: "image" },
    );
    expect(mocks.cloudinaryDestroy).not.toHaveBeenCalledWith(
      "old-user-avatar",
      { resource_type: "image" },
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 500,
      message: "Failed to update user profile",
    }));
    expect(JSON.stringify(next.mock.calls)).not.toContain("private database detail");
    expect(existsSync(file.path)).toBe(false);
  });

  it("does not persist or delete the old avatar when user-avatar upload fails", async () => {
    const file = await createTempMulterFile("user-avatar-upload-failure");
    mocks.cloudinaryUpload.mockRejectedValueOnce(new Error("private provider detail"));
    const next = vi.fn();

    await updateUser({
      user: { id: ACTOR_ID, avatarCloudinaryPublicId: "old-user-avatar" },
      file,
    } as unknown as AuthenticatedRequest, responseMock(), next as NextFunction);

    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.cloudinaryDestroy).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 500,
      message: "Failed to update user profile",
    }));
    expect(JSON.stringify(next.mock.calls)).not.toContain("private provider detail");
    expect(existsSync(file.path)).toBe(false);
  });

  it("keeps a committed user avatar when previous-avatar cleanup fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const file = await createTempMulterFile("user-avatar-old-cleanup-failure");
    mocks.cloudinaryDestroy.mockRejectedValueOnce(new Error("private cleanup detail"));
    const response = responseMock();
    const next = vi.fn();

    await updateUser({
      user: { id: ACTOR_ID, avatarCloudinaryPublicId: "old-user-avatar" },
      file,
    } as unknown as AuthenticatedRequest, response, next as NextFunction);

    expect(mocks.userUpdate).toHaveBeenCalledOnce();
    expect(mocks.cloudinaryDestroy).toHaveBeenCalledWith(
      "old-user-avatar",
      { resource_type: "image" },
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("private cleanup detail");
    expect(existsSync(file.path)).toBe(false);
    errorLog.mockRestore();
  });

  it.each([
    ["missing", undefined],
    ["unchanged", "new-avatar-id"],
  ])("skips %s previous-avatar cleanup", async (_label, existingPublicId) => {
    const file = await createTempMulterFile(`user-avatar-${_label}-old-id`);
    const response = responseMock();
    const next = vi.fn();

    await updateUser({
      user: { id: ACTOR_ID, avatarCloudinaryPublicId: existingPublicId },
      file,
    } as unknown as AuthenticatedRequest, response, next as NextFunction);

    expect(mocks.userUpdate).toHaveBeenCalledOnce();
    expect(mocks.cloudinaryDestroy).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
    expect(existsSync(file.path)).toBe(false);
  });

  it("rejects a missing user-avatar file before provider or persistence work", async () => {
    const next = vi.fn();

    await updateUser({
      user: { id: ACTOR_ID },
    } as unknown as AuthenticatedRequest, responseMock(), next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400,
      message: "Please provide an image",
    }));
    expect(mocks.cloudinaryUpload).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });
});
