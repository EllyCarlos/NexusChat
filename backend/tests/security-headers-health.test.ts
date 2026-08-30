import express from "express";
import request, { type Response } from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createOriginPolicy } from "../src/security/origin-policy.js";

const createTestApplication = (
  environment = "test",
  readiness: () => boolean = () => true,
) => {
  const testRouter = express.Router();
  testRouter.get("/ok", (_req, res) => res.status(200).json({ ok: true }));
  testRouter.get("/error", (_req, _res, next) => next(new Error("private failure")));

  const authRouter = express.Router();
  authRouter.get("/user", (_req, res) => res.status(200).json({ id: "user-1" }));
  authRouter.get("/google", (_req, res) => res.redirect("https://accounts.google.com/"));
  authRouter.get("/google/callback", (_req, res) => res.redirect("http://localhost:3000/auth/oauth-redirect"));

  return createApp({
    originPolicy: createOriginPolicy({
      environment,
      frontendOrigin: "http://localhost:3000",
    }),
    environment,
    readiness,
    routes: [
      { path: "/test", router: testRouter },
      { path: "/api/v1/auth", router: authRouter },
    ],
  });
};

const expectApiSecurityHeaders = (response: Response) => {
  expect(response.headers["x-content-type-options"]).toBe("nosniff");
  expect(response.headers["x-dns-prefetch-control"]).toBe("off");
  expect(response.headers["x-download-options"]).toBe("noopen");
  expect(response.headers["x-frame-options"]).toBe("DENY");
  expect(response.headers["x-permitted-cross-domain-policies"]).toBe("none");
  expect(response.headers["x-xss-protection"]).toBe("0");
  expect(response.headers["referrer-policy"]).toBe("no-referrer");
};

describe("API security headers and public status endpoints", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits the explicit API security-header values", async () => {
    const response = await request(createTestApplication()).get("/test/ok");

    expectApiSecurityHeaders(response);
  });

  it.each(["/test/ok", "/missing"]) (
    "removes Express fingerprinting from %s",
    async (path) => {
      const response = await request(createTestApplication()).get(path);

      expect(response.headers["x-powered-by"]).toBeUndefined();
    },
  );

  it("removes Express fingerprinting from error responses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await request(createTestApplication()).get("/test/error");

    expect(response.status).toBe(500);
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("emits HSTS in production without preload or subdomain scope", async () => {
    const response = await request(createTestApplication("production")).get("/test/ok");

    expect(response.headers["strict-transport-security"]).toBe("max-age=31536000");
  });

  it.each(["test", "development"]) (
    "does not emit HSTS in %s",
    async (environment) => {
      const response = await request(createTestApplication(environment)).get("/test/ok");

      expect(response.headers["strict-transport-security"]).toBeUndefined();
    },
  );

  it("does not apply a document CSP to API responses", async () => {
    const response = await request(createTestApplication()).get("/test/ok");

    expect(response.headers["content-security-policy"]).toBeUndefined();
  });

  it("does not apply cross-origin isolation headers to API responses", async () => {
    const response = await request(createTestApplication()).get("/test/ok");

    expect(response.headers["cross-origin-embedder-policy"]).toBeUndefined();
    expect(response.headers["cross-origin-opener-policy"]).toBeUndefined();
    expect(response.headers["cross-origin-resource-policy"]).toBeUndefined();
  });

  it("returns the exact minimal health response", async () => {
    const response = await request(createTestApplication()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("reports only a minimal unavailable state when distributed readiness is lost", async () => {
    let publisherReady = true;
    let subscriberReady = true;
    const app = createTestApplication(
      "production",
      () => publisherReady && subscriberReady,
    );

    const ready = await request(app).get("/health");
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: "ok" });

    publisherReady = false;
    const publisherUnavailable = await request(app).get("/health");
    expect(publisherUnavailable.status).toBe(503);
    expect(publisherUnavailable.body).toEqual({ status: "unavailable" });
    expect(publisherUnavailable.headers["cache-control"]).toBe("no-store");

    publisherReady = true;
    subscriberReady = false;
    const subscriberUnavailable = await request(app).get("/health");
    expect(subscriberUnavailable.status).toBe(503);
    expect(subscriberUnavailable.body).toEqual({ status: "unavailable" });
    expect(JSON.stringify(subscriberUnavailable.body)).not.toMatch(
      /redis|url|client|publisher|subscriber|credential/i,
    );
  });

  it("does not expose runtime diagnostics from health", async () => {
    const response = await request(createTestApplication()).get("/health");
    const serialized = JSON.stringify(response.body);

    expect(serialized).not.toMatch(/timestamp|memory|socket|client|uptime|environment/i);
  });

  it("keeps the root route non-diagnostic", async () => {
    const response = await request(createTestApplication()).get("/");

    expect(response.body).toEqual({ status: "ok" });
    expect(Object.keys(response.body)).toEqual(["status"]);
  });

  it.each(["/", "/health"]) (
    "marks %s as no-store",
    async (path) => {
      const response = await request(createTestApplication()).get(path);

      expect(response.headers["cache-control"]).toBe("no-store");
    },
  );

  it("marks authentication API responses as no-store", async () => {
    const response = await request(createTestApplication()).get("/api/v1/auth/user");

    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it.each(["/api/v1/auth/google", "/api/v1/auth/google/callback"]) (
    "marks OAuth response %s as no-store",
    async (path) => {
      const response = await request(createTestApplication()).get(path);

      expect(response.headers["cache-control"]).toBe("no-store");
    },
  );

  it("preserves security headers on 404 and error responses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const [notFound, error] = await Promise.all([
      request(createTestApplication()).get("/missing"),
      request(createTestApplication()).get("/test/error"),
    ]);

    expectApiSecurityHeaders(notFound);
    expectApiSecurityHeaders(error);
  });
});
