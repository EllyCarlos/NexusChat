import { EventEmitter } from "node:events";
import express, { Router, type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { ApplicationError } from "../src/errors/application-error.js";
import { createHttpObservabilityMiddleware } from "../src/middlewares/http-observability.middleware.js";
import type { LoggerPort } from "../src/observability/logger.port.js";
import { getRequestId } from "../src/observability/request-context.js";
import { REQUEST_ID_PATTERN } from "../src/observability/request-id.js";
import type { OriginPolicy } from "../src/security/origin-policy.js";
import { createCapturingLogger } from "./support/capturing-logger.js";

const TRUSTED_ORIGIN = "https://trusted.example";
const originPolicy: OriginPolicy = {
  origins: [TRUSTED_ORIGIN],
  allows: (origin) => origin === undefined || origin === TRUSTED_ORIGIN,
};

const buildHarness = ({
  logger = createCapturingLogger("application"),
  readiness = () => true,
}: {
  logger?: LoggerPort;
  readiness?: () => boolean;
} = {}) => {
  const router = Router();
  router.get("/:id", async (req, res) => {
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, req.params.id === "slow" ? 8 : 1));
    res.status(200).json({ requestId: getRequestId() });
  });
  router.get("/unauthorized/:id", (_req, _res, next) => next(new ApplicationError({
    code: "UNAUTHORIZED",
    message: "Authentication required",
    statusCode: 401,
  })));
  router.get("/failure/:id", (_req, _res, next) => {
    next(new Error("token=SUPER_SECRET_VALUE"));
  });
  router.post("/mutation/:id", (_req, res) => res.status(201).json({ ok: true }));

  const app = createApp({
    originPolicy,
    environment: "test",
    logger,
    readiness,
    routes: [{ path: "/api/v1/example", router }],
  });
  return { app, logger };
};

const completionEvents = (logger: ReturnType<typeof createCapturingLogger>) =>
  logger.events.filter(({ event }) => event === "http.request.completed");

describe("structured HTTP completion", () => {
  it("preserves a valid incoming ID and logs one normalized completion", async () => {
    const logger = createCapturingLogger("application");
    const { app } = buildHarness({ logger });
    const response = await request(app)
      .get("/api/v1/example/SECRET-RESOURCE-ID?token=VERY_SECRET")
      .set("X-Request-Id", "client-request_123");

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toBe("client-request_123");
    expect(response.body).toEqual({ requestId: "client-request_123" });
    expect(completionEvents(logger)).toEqual([{
      level: "info",
      component: "http",
      event: "http.request.completed",
      fields: {
        requestId: "client-request_123",
        method: "GET",
        route: "/api/v1/example/:id",
        statusCode: 200,
        result: "success",
        durationMs: expect.any(Number),
        responseSizeBytes: expect.any(Number),
      },
    }]);
    const output = JSON.stringify(logger.events);
    expect(output).not.toContain("SECRET-RESOURCE-ID");
    expect(output).not.toContain("VERY_SECRET");
    expect(output).not.toContain("token");
  });

  it("replaces invalid incoming IDs with a server UUID", async () => {
    const logger = createCapturingLogger("application");
    const { app } = buildHarness({ logger });
    const response = await request(app)
      .get("/api/v1/example/value")
      .set("X-Request-Id", "invalid request é");

    const selected = response.headers["x-request-id"] as string;
    expect(selected).not.toBe("invalid request é");
    expect(REQUEST_ID_PATTERN.test(selected)).toBe(true);
    expect(selected).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(completionEvents(logger)[0]?.fields.requestId).toBe(selected);
  });

  it("keeps concurrent Express requests isolated across nested async work", async () => {
    const logger = createCapturingLogger("application");
    const { app } = buildHarness({ logger });
    const [slow, fast] = await Promise.all([
      request(app).get("/api/v1/example/slow").set("X-Request-Id", "request-slow"),
      request(app).get("/api/v1/example/fast").set("X-Request-Id", "request-fast"),
    ]);

    expect(slow.body).toEqual({ requestId: "request-slow" });
    expect(fast.body).toEqual({ requestId: "request-fast" });
    expect(new Set(completionEvents(logger).map(({ fields }) => fields.requestId))).toEqual(
      new Set(["request-slow", "request-fast"]),
    );
    expect(getRequestId()).toBeUndefined();
  });

  it("uses the bounded unmatched label for a private 404 path", async () => {
    const logger = createCapturingLogger("application");
    const { app } = buildHarness({ logger });
    const response = await request(app).get("/some/private/value/SECRET");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, message: "Route not found" });
    expect(completionEvents(logger)[0]?.fields).toMatchObject({
      route: "unmatched",
      statusCode: 404,
      result: "client_error",
    });
    expect(JSON.stringify(logger.events)).not.toContain("SECRET");
  });

  it("correlates a safe 500 error event with its completion event", async () => {
    const logger = createCapturingLogger("application");
    const { app } = buildHarness({ logger });
    const response = await request(app)
      .get("/api/v1/example/failure/private-id")
      .set("X-Request-Id", "request-failure-1");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ success: false, message: "Internal server error" });
    expect(logger.events).toContainEqual({
      level: "error",
      component: "http",
      event: "http.unexpected_request.failed",
      fields: { errorType: "Error", requestId: "request-failure-1" },
    });
    expect(completionEvents(logger)[0]?.fields).toMatchObject({
      requestId: "request-failure-1",
      route: "/api/v1/example/failure/:id",
      statusCode: 500,
      result: "server_error",
    });
    const output = JSON.stringify(logger.events);
    expect(output).not.toContain("SUPER_SECRET_VALUE");
    expect(output).not.toContain("private-id");
    expect(output).not.toContain("stack");
  });

  it("logs an expected auth rejection only as an INFO completion", async () => {
    const logger = createCapturingLogger("application");
    const { app } = buildHarness({ logger });
    const response = await request(app).get("/api/v1/example/unauthorized/private-id");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ success: false, message: "Authentication required" });
    expect(logger.events.filter(({ level }) => level === "error")).toEqual([]);
    expect(completionEvents(logger)[0]?.fields).toMatchObject({
      route: "/api/v1/example/unauthorized/:id",
      statusCode: 401,
      result: "client_error",
    });
  });

  it("covers CORS rejection without logging the hostile origin", async () => {
    const logger = createCapturingLogger("application");
    const { app } = buildHarness({ logger });
    const response = await request(app)
      .get("/api/v1/example/value")
      .set("Origin", "https://hostile.example")
      .set("X-Request-Id", "request-cors-1");

    expect(response.status).toBe(403);
    expect(response.headers["x-request-id"]).toBe("request-cors-1");
    expect(completionEvents(logger)[0]?.fields).toMatchObject({
      route: "pre_route",
      statusCode: 403,
      result: "client_error",
    });
    expect(JSON.stringify(logger.events)).not.toContain("hostile.example");
  });

  it("covers mutation-origin rejection without changing its public response", async () => {
    const logger = createCapturingLogger("application");
    const { app } = buildHarness({ logger });
    const response = await request(app)
      .post("/api/v1/example/mutation/private-id")
      .set("Cookie", "session=opaque-session-token");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: false, message: "Origin not allowed" });
    expect(completionEvents(logger)[0]?.fields).toMatchObject({
      route: "pre_route",
      method: "POST",
      statusCode: 403,
      result: "client_error",
    });
    expect(JSON.stringify(logger.events)).not.toContain("opaque-session-token");
  });

  it("exposes only the request ID response header to an admitted browser origin", async () => {
    const { app } = buildHarness();
    const response = await request(app)
      .get("/api/v1/example/value")
      .set("Origin", TRUSTED_ORIGIN);

    expect(response.headers["access-control-allow-origin"]).toBe(TRUSTED_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["access-control-expose-headers"]).toBe("X-Request-Id");
  });

  it("suppresses healthy health probes but records unavailable health", async () => {
    const logger = createCapturingLogger("application");
    let ready = true;
    const { app } = buildHarness({ logger, readiness: () => ready });

    const healthy = await request(app).get("/health");
    expect(healthy.status).toBe(200);
    expect(healthy.body).toEqual({ status: "ok" });
    expect(completionEvents(logger)).toEqual([]);

    ready = false;
    const unhealthy = await request(app).get("/health");
    expect(unhealthy.status).toBe(503);
    expect(unhealthy.body).toEqual({ status: "unavailable" });
    expect(completionEvents(logger)[0]?.fields).toMatchObject({
      route: "/health",
      statusCode: 503,
      result: "server_error",
    });
  });

  it("does not let a throwing completion logger affect the response", async () => {
    const throwingLogger: LoggerPort = {
      component: "application",
      forComponent: () => throwingLogger,
      debug: () => { throw new Error("logger debug failure"); },
      info: () => { throw new Error("logger info failure"); },
      warn: () => { throw new Error("logger warn failure"); },
      error: () => { throw new Error("logger error failure"); },
    };
    const { app } = buildHarness({ logger: throwingLogger });

    const response = await request(app).get("/api/v1/example/value");
    expect(response.status).toBe(200);
    expect(response.body.requestId).toMatch(REQUEST_ID_PATTERN);
  });

  it("logs an abrupt close once with a bounded aborted result", () => {
    const logger = createCapturingLogger("application");
    const responseEmitter = new EventEmitter();
    const headers = new Map<string, string | number>();
    const response = Object.assign(responseEmitter, {
      statusCode: 200,
      writableFinished: false,
      setHeader: (name: string, value: string | number) => headers.set(name, value),
      getHeader: (name: string) => headers.get(name),
    });
    const requestObject = {
      method: "GET",
      get: () => undefined,
      res: response,
    };
    const clock = vi.fn()
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(14);
    const middleware = createHttpObservabilityMiddleware({
      logger,
      clock,
      generateRequestId: () => "generated-abort-id",
    });

    middleware(
      requestObject as unknown as Request,
      response as unknown as Response,
      () => expect(getRequestId()).toBe("generated-abort-id"),
    );
    responseEmitter.emit("close");
    responseEmitter.emit("finish");

    expect(completionEvents(logger)).toEqual([{
      level: "info",
      component: "http",
      event: "http.request.completed",
      fields: {
        requestId: "generated-abort-id",
        method: "GET",
        route: "pre_route",
        statusCode: 200,
        result: "aborted",
        durationMs: 4,
      },
    }]);
    expect(getRequestId()).toBeUndefined();
  });
});
