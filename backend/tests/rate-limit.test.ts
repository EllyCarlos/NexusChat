import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn((req: Request, res: Response, next: NextFunction) => {
    const authorization = req.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      res.status(401).json({ success: false, message: "Authentication is required" });
      return;
    }
    (req as Request & { user: { id: string; username: string } }).user = {
      id: authorization.slice("Bearer ".length),
      username: "test-user",
    };
    next();
  }),
  avatarMultipartWork: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  attachmentMultipartWork: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  testEmailHandler: vi.fn((_req: Request, res: Response) => res.status(204).send()),
  updateUser: vi.fn((_req: Request, res: Response) => res.status(204).send()),
  uploadAttachment: vi.fn((_req: Request, res: Response) => res.status(204).send()),
  fetchAttachments: vi.fn((_req: Request, res: Response) => res.status(200).json([])),
}));

vi.mock("../src/middlewares/verify-token.middleware.js", () => ({
  verifyToken: mocks.verifyToken,
}));

vi.mock("../src/middlewares/multer.middleware.js", () => ({
  avatarUpload: { single: () => mocks.avatarMultipartWork },
  attachmentUpload: { array: () => mocks.attachmentMultipartWork },
}));

vi.mock("../src/middlewares/file-validation.middleware.js", () => ({
  fileValidation: (_req: Request, _res: Response, next: NextFunction) => next(),
  attachmentFileValidation: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../src/middlewares/upload-authorization.middleware.js", () => ({
  authorizeAttachmentUpload: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../src/controllers/user.controller.js", () => ({
  testEmailHandler: mocks.testEmailHandler,
  updateUser: mocks.updateUser,
}));

vi.mock("../src/controllers/attachment.controller.js", () => ({
  fetchAttachments: mocks.fetchAttachments,
  uploadAttachment: mocks.uploadAttachment,
}));

import { createApp } from "../src/app.js";
import {
  BACKEND_RATE_LIMITS,
  enforcePairRateLimit,
  fcmTokenRateLimit,
} from "../src/middlewares/rate-limit.middleware.js";
import userRouter from "../src/routes/user.router.js";
import attachmentRouter from "../src/routes/attachment.router.js";
import {
  BoundedInMemoryRateLimiter,
  clearBackendRateLimitsForTests,
  RATE_LIMIT_MESSAGE,
} from "../src/security/rate-limit.js";
import {
  createOriginPolicy,
  PRODUCTION_FRONTEND_ORIGIN,
} from "../src/security/origin-policy.js";

const createRateTestApp = () => createApp({
  environment: "test",
  originPolicy: createOriginPolicy({
    environment: "production",
    frontendOrigin: PRODUCTION_FRONTEND_ORIGIN,
  }),
  routes: [
    { path: "/api/v1/user", router: userRouter },
    { path: "/api/v1/attachment", router: attachmentRouter },
  ],
  requestLogger: (_req, _res, next) => next(),
});

beforeEach(() => {
  vi.clearAllMocks();
  clearBackendRateLimitsForTests();
});

describe("backend non-IP limiter state", () => {
  it("uses a deterministic clock while bounding and expiring stored keys", () => {
    let now = 10_000;
    const limiter = new BoundedInMemoryRateLimiter(2, () => now);
    const policy = { namespace: "bounded-test", limit: 1, windowMs: 1_000 };

    limiter.consume(policy, "raw-user-a");
    limiter.consume(policy, "raw-user-b");
    limiter.consume(policy, "raw-user-c");
    expect(limiter.size).toBe(2);

    now = 11_001;
    expect(limiter.check(policy, "new-user").allowed).toBe(true);
    expect(limiter.size).toBe(0);
  });
});

describe("friend-request pair controls", () => {
  const response = () => ({ setHeader: vi.fn() } as unknown as Response);

  it("throttles a repeated sender/receiver pair and emits a stable 429 error", () => {
    const res = response();
    const next = vi.fn();
    const attempt = (otherUserId: string) => enforcePairRateLimit({
      response: res,
      next,
      actorUserId: "sender-a",
      otherUserId,
      policy: BACKEND_RATE_LIMITS.friendCreateCooldown,
      secondPolicy: BACKEND_RATE_LIMITS.friendCreateWindow,
    });

    expect(attempt("receiver-a")).toBe(true);
    expect(attempt("receiver-a")).toBe(false);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 429,
      message: RATE_LIMIT_MESSAGE,
    }));
    expect((res.setHeader as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("Retry-After", "30");
  });

  it("keeps a different receiver independent and separates create from handle buckets", () => {
    const res = response();
    const next = vi.fn();

    expect(enforcePairRateLimit({
      response: res,
      next,
      actorUserId: "sender-a",
      otherUserId: "receiver-a",
      policy: BACKEND_RATE_LIMITS.friendCreateCooldown,
      secondPolicy: BACKEND_RATE_LIMITS.friendCreateWindow,
    })).toBe(true);
    expect(enforcePairRateLimit({
      response: res,
      next,
      actorUserId: "sender-a",
      otherUserId: "receiver-b",
      policy: BACKEND_RATE_LIMITS.friendCreateCooldown,
      secondPolicy: BACKEND_RATE_LIMITS.friendCreateWindow,
    })).toBe(true);
    expect(enforcePairRateLimit({
      response: res,
      next,
      actorUserId: "receiver-a",
      otherUserId: "sender-a",
      policy: BACKEND_RATE_LIMITS.friendHandle,
    })).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("test-email route method, authentication, origin, and throttling", () => {
  it("does not expose the mail side effect over GET", async () => {
    const response = await request(createRateTestApp())
      .get("/api/v1/user/test-email")
      .set("Authorization", "Bearer user-a");

    expect(response.status).toBe(404);
    expect(mocks.testEmailHandler).not.toHaveBeenCalled();
  });

  it("requires authentication for POST", async () => {
    const response = await request(createRateTestApp()).post("/api/v1/user/test-email");

    expect(response.status).toBe(401);
    expect(mocks.testEmailHandler).not.toHaveBeenCalled();
  });

  it("rejects hostile browser Origin before authentication and mail work", async () => {
    const response = await request(createRateTestApp())
      .post("/api/v1/user/test-email")
      .set("Origin", "https://attacker.example")
      .set("Authorization", "Bearer user-a");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: false, message: "Origin not allowed" });
    expect(mocks.verifyToken).not.toHaveBeenCalled();
    expect(mocks.testEmailHandler).not.toHaveBeenCalled();
  });

  it("throttles repeated authenticated POST per user with Retry-After", async () => {
    const app = createRateTestApp();
    const first = await request(app)
      .post("/api/v1/user/test-email")
      .set("Authorization", "Bearer user-a");
    const repeated = await request(app)
      .post("/api/v1/user/test-email")
      .set("Authorization", "Bearer user-a");
    const otherUser = await request(app)
      .post("/api/v1/user/test-email")
      .set("Authorization", "Bearer user-b");

    expect(first.status).toBe(204);
    expect(repeated.status).toBe(429);
    expect(repeated.body).toEqual({ success: false, message: RATE_LIMIT_MESSAGE });
    expect(repeated.headers["retry-after"]).toBe("60");
    expect(otherUser.status).toBe(204);
    expect(mocks.testEmailHandler).toHaveBeenCalledTimes(2);
  });
});

describe("upload and FCM request controls", () => {
  it.each([
    ["avatar", "patch", "/api/v1/user", 10, mocks.avatarMultipartWork],
    ["attachment", "post", "/api/v1/attachment/chat-a", 60, mocks.attachmentMultipartWork],
  ] as const)(
    "throttles repeated %s requests before multipart expense and isolates users",
    async (_label, method, path, limit, multipartWork) => {
      const app = createRateTestApp();
      const makeRequest = (userId: string) => method === "patch"
        ? request(app).patch(path)
          .set("Authorization", `Bearer ${userId}`)
          .set("Content-Type", "multipart/form-data; boundary=rate-limit-test")
        : request(app).post(path).set("Authorization", `Bearer ${userId}`);

      for (let attempt = 0; attempt < limit; attempt += 1) {
        expect((await makeRequest("user-a")).status).toBe(204);
      }
      const limited = await makeRequest("user-a");
      expect(limited.status).toBe(429);
      expect(limited.body).toEqual({ success: false, message: RATE_LIMIT_MESSAGE });
      expect(multipartWork).toHaveBeenCalledTimes(limit);

      expect((await makeRequest("user-b")).status).toBe(204);
      expect(multipartWork).toHaveBeenCalledTimes(limit + 1);
    },
  );

  it("keeps the backend FCM mutation limit generous and per authenticated user", async () => {
    const router = express.Router();
    const writeWork = vi.fn((_req: Request, res: Response) => res.status(204).send());
    router.patch("/fcm", mocks.verifyToken, fcmTokenRateLimit, writeWork);
    const app = createApp({
      environment: "test",
      originPolicy: createOriginPolicy({
        environment: "production",
        frontendOrigin: PRODUCTION_FRONTEND_ORIGIN,
      }),
      routes: [{ path: "/api", router }],
      requestLogger: (_req, _res, next) => next(),
    });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect((await request(app).patch("/api/fcm").set("Authorization", "Bearer user-a")).status)
        .toBe(204);
    }
    expect((await request(app).patch("/api/fcm").set("Authorization", "Bearer user-a")).status)
      .toBe(429);
    expect((await request(app).patch("/api/fcm").set("Authorization", "Bearer user-b")).status)
      .toBe(204);
    expect(writeWork).toHaveBeenCalledTimes(21);
  });
});
