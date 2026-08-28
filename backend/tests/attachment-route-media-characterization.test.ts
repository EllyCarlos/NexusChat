import type { RequestHandler } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => {
  const attachmentUploadHandler = vi.fn();

  return {
    attachmentFileValidation: vi.fn(),
    attachmentUploadArray: vi.fn(() => attachmentUploadHandler),
    attachmentUploadHandler,
    authorizeAttachmentUpload: vi.fn(),
    fetchAttachments: vi.fn(),
    uploadAttachment: vi.fn(),
    uploadCleanupBoundary: vi.fn(),
    verifyToken: vi.fn(),
  };
});

const mediaMocks = vi.hoisted(() => ({
  cloudinaryDestroy: vi.fn(),
  cloudinaryUpload: vi.fn(),
}));

vi.mock("../src/controllers/attachment.controller.js", () => ({
  fetchAttachments: routeMocks.fetchAttachments,
  uploadAttachment: routeMocks.uploadAttachment,
}));

vi.mock("../src/middlewares/verify-token.middleware.js", () => ({
  verifyToken: routeMocks.verifyToken,
}));

vi.mock("../src/middlewares/upload-authorization.middleware.js", () => ({
  authorizeAttachmentUpload: routeMocks.authorizeAttachmentUpload,
}));

vi.mock("../src/utils/upload-lifecycle.util.js", () => ({
  uploadCleanupBoundary: routeMocks.uploadCleanupBoundary,
}));

vi.mock("../src/middlewares/multer.middleware.js", () => ({
  attachmentUpload: {
    array: routeMocks.attachmentUploadArray,
  },
}));

vi.mock("../src/middlewares/file-validation.middleware.js", () => ({
  attachmentFileValidation: routeMocks.attachmentFileValidation,
}));

vi.mock("cloudinary", () => ({
  v2: {
    uploader: {
      destroy: mediaMocks.cloudinaryDestroy,
      upload: mediaMocks.cloudinaryUpload,
    },
  },
}));

import {
  attachmentUploadRateLimit,
  BACKEND_RATE_LIMITS,
} from "../src/middlewares/rate-limit.middleware.js";
import attachmentRouter from "../src/routes/attachment.router.js";
import { uploadFilesToCloudinary } from "../src/utils/auth.util.js";

type RouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
};

const routeLayers = () => (
  attachmentRouter as unknown as { stack: RouterLayer[] }
).stack.filter((layer): layer is Required<Pick<RouterLayer, "route">> => Boolean(layer.route));

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
};

beforeEach(() => {
  mediaMocks.cloudinaryDestroy.mockReset();
  mediaMocks.cloudinaryUpload.mockReset();
});

describe("attachment route characterization", () => {
  it("keeps the exact POST and GET method/path inventory", () => {
    expect(routeLayers().map(({ route }) => ({
      methods: Object.keys(route.methods),
      path: route.path,
    }))).toEqual([
      { methods: ["post"], path: "/:chatId" },
      { methods: ["get"], path: "/:id" },
    ]);
  });

  it("binds attachments[] with max five and keeps authorization before Multer in the POST stack", () => {
    expect(routeMocks.attachmentUploadArray).toHaveBeenCalledOnce();
    expect(routeMocks.attachmentUploadArray).toHaveBeenCalledWith("attachments[]", 5);

    const postLayer = routeLayers().find(({ route }) => route.methods.post);
    const stack = postLayer?.route.stack.map(({ handle }) => handle);

    expect(stack).toEqual([
      routeMocks.verifyToken,
      attachmentUploadRateLimit,
      routeMocks.authorizeAttachmentUpload,
      routeMocks.uploadCleanupBoundary,
      routeMocks.attachmentUploadHandler,
      routeMocks.attachmentFileValidation,
      routeMocks.uploadAttachment,
    ]);
    expect(stack?.indexOf(routeMocks.authorizeAttachmentUpload))
      .toBeLessThan(stack?.indexOf(routeMocks.attachmentUploadHandler) ?? -1);
  });

  it("keeps the GET stack authenticated and terminated by the read controller", () => {
    const getLayer = routeLayers().find(({ route }) => route.methods.get);

    expect(getLayer?.route.stack.map(({ handle }) => handle)).toEqual([
      routeMocks.verifyToken,
      routeMocks.fetchAttachments,
    ]);
  });

  it("keeps the attachment upload rate bucket at 60 requests per ten minutes", () => {
    expect(BACKEND_RATE_LIMITS.attachmentUpload).toEqual({
      namespace: "attachment-upload",
      limit: 60,
      windowMs: 10 * 60 * 1000,
    });
  });
});

describe("Cloudinary multi-file helper characterization", () => {
  it("uploads files sequentially in input order and returns the provider results unchanged", async () => {
    const firstUpload = deferred<unknown>();
    const secondUpload = deferred<unknown>();
    const thirdUpload = deferred<unknown>();
    const firstResult = {
      public_id: "first-id",
      secure_url: "https://cloudinary.example/first",
      providerOnly: "first-provider-value",
    };
    const secondResult = {
      public_id: "second-id",
      secure_url: "https://cloudinary.example/second",
      providerOnly: "second-provider-value",
    };
    const thirdResult = {
      public_id: "third-id",
      secure_url: "https://cloudinary.example/third",
      providerOnly: "third-provider-value",
    };
    mediaMocks.cloudinaryUpload
      .mockReturnValueOnce(firstUpload.promise)
      .mockReturnValueOnce(secondUpload.promise)
      .mockReturnValueOnce(thirdUpload.promise);

    const resultPromise = uploadFilesToCloudinary({
      files: [
        { path: "first-temp" },
        { path: "second-temp" },
        { path: "third-temp" },
      ] as Express.Multer.File[],
    });

    expect(mediaMocks.cloudinaryUpload).toHaveBeenCalledTimes(1);
    expect(mediaMocks.cloudinaryUpload).toHaveBeenNthCalledWith(1, "first-temp");

    firstUpload.resolve(firstResult);
    await vi.waitFor(() => expect(mediaMocks.cloudinaryUpload).toHaveBeenCalledTimes(2));
    expect(mediaMocks.cloudinaryUpload).toHaveBeenNthCalledWith(2, "second-temp");

    secondUpload.resolve(secondResult);
    await vi.waitFor(() => expect(mediaMocks.cloudinaryUpload).toHaveBeenCalledTimes(3));
    expect(mediaMocks.cloudinaryUpload).toHaveBeenNthCalledWith(3, "third-temp");

    thirdUpload.resolve(thirdResult);
    await expect(resultPromise).resolves.toEqual([
      firstResult,
      secondResult,
      thirdResult,
    ]);
    expect(mediaMocks.cloudinaryDestroy).not.toHaveBeenCalled();
  });

  it("rolls back only completed uploads, stops at the first failure, and preserves that failure when deletion rejects", async () => {
    const uploadFailure = new Error("provider upload secret");
    const rollbackFailure = new Error("provider deletion secret");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mediaMocks.cloudinaryUpload
      .mockResolvedValueOnce({
        public_id: "completed-id",
        secure_url: "https://cloudinary.example/completed",
      })
      .mockRejectedValueOnce(uploadFailure);
    mediaMocks.cloudinaryDestroy.mockRejectedValueOnce(rollbackFailure);

    const resultPromise = uploadFilesToCloudinary({
      files: [
        { path: "completed-temp" },
        { path: "failed-temp" },
        { path: "never-started-temp" },
      ] as Express.Multer.File[],
    });

    await expect(resultPromise).rejects.toBe(uploadFailure);
    expect(mediaMocks.cloudinaryUpload.mock.calls).toEqual([
      ["completed-temp"],
      ["failed-temp"],
    ]);
    expect(mediaMocks.cloudinaryDestroy).toHaveBeenCalledOnce();
    expect(mediaMocks.cloudinaryDestroy).toHaveBeenCalledWith(
      "completed-id",
      { resource_type: "image" },
    );
    expect(consoleError.mock.calls).toEqual([
      ["Cloudinary file deletion failed.", { errorType: "Error" }],
      ["Cloudinary file upload failed.", { errorType: "Error" }],
    ]);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("provider upload secret");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("provider deletion secret");

    consoleError.mockRestore();
  });
});
