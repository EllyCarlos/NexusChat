import express from "express";
import multer from "multer";
import request from "supertest";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

import { createApp } from "../src/app.js";
import { createRequestLogger } from "../src/middlewares/request-logger.middleware.js";
import { verifyToken } from "../src/middlewares/verify-token.middleware.js";
import { CustomError } from "../src/utils/error.utils.js";

const INTERNAL_MESSAGE = "Prisma connection failed with password=database-secret";

const createTestApplication = (writeLog: (line: string) => void = () => undefined) => {
  const router = express.Router();
  const testUpload = multer({ limits: { fileSize: 1, files: 1 } });

  router.get("/unexpected", (_req, _res, next) => {
    const error = new Error(INTERNAL_MESSAGE);
    error.stack = `Error: ${INTERNAL_MESSAGE}\n at C:\\internal\\source.ts:12:3`;
    next(error);
  });
  router.get("/custom", (_req, _res, next) => next(new CustomError("Conflict is safe", 409)));
  router.get("/validation", () => {
    z.object({ name: z.string().min(1, "Name is required") }).parse({ name: "" });
  });
  router.get("/jwt", verifyToken, (_req, res) => res.status(204).send());
  router.post("/file", testUpload.single("file"), (_req, res) => res.status(204).send());

  return createApp({
    corsOrigins: ["http://localhost:3000"],
    environment: "test",
    routes: [{ path: "/test", router }],
    requestLogger: createRequestLogger({ stream: { write: writeLog } }),
    getConnectedClientCount: () => 3,
  });
};

describe("HTTP application boundary", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-that-is-long-enough";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("constructs the application without starting a listener", () => {
    const listenSpy = vi.spyOn(express.application, "listen");

    const app = createTestApplication();

    expect(app).toBeTypeOf("function");
    expect(listenSpy).not.toHaveBeenCalled();
  });

  it.each(["/definitely-not-a-route", "/api/v1/unknown"]) (
    "returns a stable JSON 404 for %s",
    async (path) => {
      const response = await request(createTestApplication()).get(path);

      expect(response.status).toBe(404);
      expect(response.type).toMatch(/json/);
      expect(response.body).toEqual({ success: false, message: "Route not found" });
    },
  );

  it("returns a generic 500 without the raw message or stack", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(createTestApplication()).get("/test/unexpected");
    const serialized = JSON.stringify(response.body);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ success: false, message: "Internal server error" });
    expect(serialized).not.toContain(INTERNAL_MESSAGE);
    expect(serialized).not.toContain("internal\\source.ts");
  });

  it("preserves a client-safe CustomError status and message", async () => {
    const response = await request(createTestApplication()).get("/test/custom");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ success: false, message: "Conflict is safe" });
  });

  it("preserves safe Zod validation detail", async () => {
    const response = await request(createTestApplication()).get("/test/validation");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, message: "Name is required" });
  });

  it("does not expose jsonwebtoken verifier details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(createTestApplication())
      .get("/test/jwt")
      .set("Authorization", "Bearer malformed-session-jwt");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ success: false, message: "Invalid or expired token" });
    expect(JSON.stringify(response.body)).not.toMatch(/jwt malformed|signature|audience|issuer/i);
  });

  it("normalizes Multer file-size errors to 413", async () => {
    const response = await request(createTestApplication())
      .post("/test/file")
      .attach("file", Buffer.from("too large"), "file.txt");

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ success: false, message: "File is too large" });
  });

  it("normalizes Multer unexpected-field errors to 400", async () => {
    const response = await request(createTestApplication())
      .post("/test/file")
      .attach("unexpected", Buffer.from("x"), "file.txt");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: "Unexpected file field or too many files",
    });
  });

  it("keeps request logging pathname-only", async () => {
    const lines: string[] = [];
    await request(createTestApplication((line) => lines.push(line)))
      .get("/definitely-not-a-route?token=session-secret&code=google-code&state=oauth-state");

    const output = lines.join("\n");
    expect(output).toContain("/definitely-not-a-route");
    expect(output).not.toContain("session-secret");
    expect(output).not.toContain("google-code");
    expect(output).not.toContain("oauth-state");
    expect(output).not.toContain("?");
  });

  it("preserves the current root and health response fields", async () => {
    const app = createTestApplication();
    const [root, health] = await Promise.all([
      request(app).get("/"),
      request(app).get("/health"),
    ]);

    expect(root.status).toBe(200);
    expect(root.body).toMatchObject({ status: "OK", running: true, environment: "test", connectedClients: 3 });
    expect(root.body.timestamp).toBeTypeOf("string");
    expect(root.body.uptime).toBeTypeOf("number");
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({
      status: "healthy",
      services: { server: "running", socket: "3 clients connected" },
    });
    expect(health.body.services.memory.used).toMatch(/ MB$/);
    expect(health.body.services.memory.total).toMatch(/ MB$/);
  });
});
