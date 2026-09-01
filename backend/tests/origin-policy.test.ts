import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createRequestLogger } from "../src/middlewares/request-logger.middleware.js";
import {
  createOriginPolicy,
  DEVELOPMENT_FRONTEND_ORIGIN,
  PRODUCTION_FRONTEND_ORIGIN,
} from "../src/security/origin-policy.js";

const PRODUCTION_PREVIEW_ORIGIN = "https://nexuschat-preview.vercel.app";

afterEach(() => {
  vi.restoreAllMocks();
});

const createOriginTestApp = (originPolicy = createOriginPolicy({
  environment: "production",
  frontendOrigin: PRODUCTION_FRONTEND_ORIGIN,
})) => {
  const router = express.Router();
  const protectedWork = vi.fn((_req: Request, _res: Response, next: NextFunction) => next());
  const oauthStateWork = vi.fn((_req: Request, _res: Response, next: NextFunction) => next());
  const upload = multer({ storage: multer.memoryStorage() });

  router.get("/resource", (_req, res) => res.status(200).json({ success: true }));
  router.post("/mutation", protectedWork, (_req, res) => res.status(204).send());
  router.patch("/avatar", protectedWork, upload.single("avatar"), (_req, res) => res.status(204).send());
  router.post("/attachment", protectedWork, upload.array("attachments[]", 5), (_req, res) => res.status(204).send());
  router.get("/auth/google/callback", oauthStateWork, (_req, res) => res.status(204).send());

  const app = createApp({
    originPolicy,
    environment: "test",
    routes: [{ path: "/api/v1", router }],
    requestLogger: createRequestLogger({ stream: { write: () => undefined } }),
  });

  return { app, protectedWork, oauthStateWork };
};

describe("REST browser-origin policy", () => {
  it("allows the exact production frontend origin with credential headers", async () => {
    const { app } = createOriginTestApp();

    const response = await request(app)
      .get("/api/v1/resource")
      .set("Origin", PRODUCTION_FRONTEND_ORIGIN);

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(PRODUCTION_FRONTEND_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("allows localhost only when it is explicitly present in development policy", async () => {
    const policy = createOriginPolicy({
      environment: "development",
      frontendOrigin: DEVELOPMENT_FRONTEND_ORIGIN,
    });
    const { app } = createOriginTestApp(policy);

    const response = await request(app)
      .get("/api/v1/resource")
      .set("Origin", DEVELOPMENT_FRONTEND_ORIGIN);

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(DEVELOPMENT_FRONTEND_ORIGIN);
  });

  it("actively rejects an unknown present Origin with stable JSON", async () => {
    const { app } = createOriginTestApp();

    const response = await request(app)
      .get("/api/v1/resource")
      .set("Origin", "https://attacker.example");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: false, message: "Origin not allowed" });
    expect(JSON.stringify(response.body)).not.toContain(PRODUCTION_FRONTEND_ORIGIN);
  });

  it("allows missing Origin for ordinary non-browser requests", async () => {
    const { app } = createOriginTestApp();

    const response = await request(app).get("/api/v1/resource");

    expect(response.status).toBe(200);
    expect(response.headers).not.toHaveProperty("access-control-allow-origin");
  });

  it("allows preflight for the exact frontend origin without authentication", async () => {
    const { app, protectedWork } = createOriginTestApp();

    const response = await request(app)
      .options("/api/v1/mutation")
      .set("Origin", PRODUCTION_FRONTEND_ORIGIN)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization,content-type");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(PRODUCTION_FRONTEND_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(response.headers["access-control-allow-headers"]).toBe("authorization,content-type");
    expect(protectedWork).not.toHaveBeenCalled();
  });

  it("rejects hostile preflight before authentication or route work", async () => {
    const { app, protectedWork } = createOriginTestApp();

    const response = await request(app)
      .options("/api/v1/mutation")
      .set("Origin", "https://attacker.example")
      .set("Access-Control-Request-Method", "POST");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: false, message: "Origin not allowed" });
    expect(protectedWork).not.toHaveBeenCalled();
  });

  it("ignores malformed configured origins without broadening access or logging their values", async () => {
    const onInvalidConfiguredOrigin = vi.fn();
    const malformed = "javascript:alert(document.cookie)";
    const policy = createOriginPolicy({
      environment: "production",
      frontendOrigin: malformed,
      vercelUrl: "not-a-vercel-host.example.com",
      onInvalidConfiguredOrigin,
    });
    const { app } = createOriginTestApp(policy);

    const response = await request(app)
      .get("/api/v1/resource")
      .set("Origin", "https://attacker.example");

    expect(policy.origins).toEqual([]);
    expect(response.status).toBe(403);
    expect(onInvalidConfiguredOrigin).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(onInvalidConfiguredOrigin.mock.calls)).not.toContain(malformed);
  });

  it("normalizes a hostname-only VERCEL_URL to one exact HTTPS origin", () => {
    const policy = createOriginPolicy({
      environment: "production",
      frontendOrigin: PRODUCTION_FRONTEND_ORIGIN,
      vercelUrl: "nexuschat-preview.vercel.app",
    });

    expect(policy.origins).toEqual([
      PRODUCTION_FRONTEND_ORIGIN,
      PRODUCTION_PREVIEW_ORIGIN,
    ]);
    expect(policy.allows(PRODUCTION_PREVIEW_ORIGIN)).toBe(true);
  });

  it("deduplicates configured origins and rejects insecure VERCEL_URL values", () => {
    const duplicatePolicy = createOriginPolicy({
      environment: "production",
      frontendOrigin: PRODUCTION_FRONTEND_ORIGIN,
      vercelUrl: PRODUCTION_FRONTEND_ORIGIN,
    });
    const insecurePolicy = createOriginPolicy({
      environment: "production",
      frontendOrigin: PRODUCTION_FRONTEND_ORIGIN,
      vercelUrl: "http://nexuschat-preview.vercel.app",
      onInvalidConfiguredOrigin: () => undefined,
    });

    expect(duplicatePolicy.origins).toEqual([PRODUCTION_FRONTEND_ORIGIN]);
    expect(insecurePolicy.origins).toEqual([PRODUCTION_FRONTEND_ORIGIN]);
  });

  it("rejects wildcard and suffix-lookalike origins", () => {
    const policy = createOriginPolicy({
      environment: "production",
      frontendOrigin: PRODUCTION_FRONTEND_ORIGIN,
      vercelUrl: "nexuschat-preview.vercel.app",
    });

    expect(policy.allows("https://sub.nexuswebapp.vercel.app")).toBe(false);
    expect(policy.allows("https://nexuschat-preview.vercel.app.example.com")).toBe(false);
    expect(policy.allows("https://evil-vercel.app.example.com")).toBe(false);
  });
});

describe("state-changing request origin boundary", () => {
  it("rejects a hostile cookie-authenticated mutation before protected work", async () => {
    const { app, protectedWork } = createOriginTestApp();

    const response = await request(app)
      .post("/api/v1/mutation")
      .set("Origin", "https://attacker.example")
      .set("Cookie", "session=opaque-session-token");

    expect(response.status).toBe(403);
    expect(protectedWork).not.toHaveBeenCalled();
  });

  it("requires Origin for a mutation presenting only the session cookie", async () => {
    const { app, protectedWork } = createOriginTestApp();

    const response = await request(app)
      .post("/api/v1/mutation")
      .set("Cookie", "session=opaque-session-token");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: false, message: "Origin not allowed" });
    expect(protectedWork).not.toHaveBeenCalled();
  });

  it("lets an allowed-origin mutation reach normal authentication and route work", async () => {
    const { app, protectedWork } = createOriginTestApp();

    const response = await request(app)
      .post("/api/v1/mutation")
      .set("Origin", PRODUCTION_FRONTEND_ORIGIN)
      .set("Authorization", "Bearer opaque-session-token");

    expect(response.status).toBe(204);
    expect(protectedWork).toHaveBeenCalledOnce();
  });

  it("allows a Bearer-authenticated mutation without Origin", async () => {
    const { app, protectedWork } = createOriginTestApp();

    const response = await request(app)
      .post("/api/v1/mutation")
      .set("Authorization", "Bearer opaque-session-token");

    expect(response.status).toBe(204);
    expect(protectedWork).toHaveBeenCalledOnce();
  });

  it.each([
    ["avatar", "PATCH", "/api/v1/avatar", "avatar"],
    ["attachment", "POST", "/api/v1/attachment", "attachments[]"],
  ])("rejects hostile %s multipart upload before auth or Multer", async (_label, method, path, field) => {
    const { app, protectedWork } = createOriginTestApp();
    const uploadRequest = method === "PATCH" ? request(app).patch(path) : request(app).post(path);

    const response = await uploadRequest
      .set("Origin", "https://attacker.example")
      .set("Authorization", "Bearer opaque-session-token")
      .attach(field, Buffer.from("content"), "upload.txt");

    expect(response.status).toBe(403);
    expect(protectedWork).not.toHaveBeenCalled();
  });

  it.each([
    ["avatar", "PATCH", "/api/v1/avatar", "avatar"],
    ["attachment", "POST", "/api/v1/attachment", "attachments[]"],
  ])("allows authenticated %s multipart upload from the frontend origin", async (_label, method, path, field) => {
    const { app, protectedWork } = createOriginTestApp();
    const uploadRequest = method === "PATCH" ? request(app).patch(path) : request(app).post(path);

    const response = await uploadRequest
      .set("Origin", PRODUCTION_FRONTEND_ORIGIN)
      .set("Authorization", "Bearer opaque-session-token")
      .attach(field, Buffer.from("content"), "upload.txt");

    expect(response.status).toBe(204);
    expect(protectedWork).toHaveBeenCalledOnce();
  });

  it("does not apply mutation-origin requirements to the OAuth GET callback", async () => {
    const { app, oauthStateWork } = createOriginTestApp();

    const response = await request(app).get("/api/v1/auth/google/callback?state=signed-state");

    expect(response.status).toBe(204);
    expect(oauthStateWork).toHaveBeenCalledOnce();
  });
});
