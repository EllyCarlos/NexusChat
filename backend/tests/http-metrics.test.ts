import { EventEmitter } from "node:events";
import { Router, type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { ApplicationError } from "../src/errors/application-error.js";
import {
  classifyHttpStatusClass,
  createHttpObservabilityMiddleware,
} from "../src/middlewares/http-observability.middleware.js";
import type { MetricsPort } from "../src/observability/metrics.port.js";
import type { OriginPolicy } from "../src/security/origin-policy.js";
import { createCapturingLogger } from "./support/capturing-logger.js";
import { createCapturingMetrics } from "./support/capturing-metrics.js";

const TRUSTED_ORIGIN = "https://trusted.example";
const originPolicy: OriginPolicy = {
  origins: [TRUSTED_ORIGIN],
  allows: (origin) => origin === undefined || origin === TRUSTED_ORIGIN,
};

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const createHarness = (metrics = createCapturingMetrics()) => {
  const router = Router();
  router.get("/redirect", (_request, response) => response.redirect(302, "/"));
  router.get("/bad-request", (_request, response) => response.status(400).json({ ok: false }));
  router.get("/unauthorized", (_request, _response, next) => next(new ApplicationError({
    code: "UNAUTHORIZED",
    message: "Authentication required",
    statusCode: 401,
  })));
  router.get("/failure", (_request, _response, next) => next(new Error("private failure")));
  router.get("/:id", (_request, response) => response.status(200).json({ ok: true }));
  router.post("/mutation/:id", (_request, response) => response.status(201).json({ ok: true }));

  const app = createApp({
    originPolicy,
    environment: "test",
    metrics,
    logger: createCapturingLogger("application"),
    routes: [{ path: "/api/v1/example", router }],
  });
  return { app, metrics };
};

describe("HTTP metrics lifecycle", () => {
  it("uses route templates without resource IDs, query strings, or request IDs", async () => {
    const { app, metrics } = createHarness();
    await request(app)
      .get("/api/v1/example/USER-123456789?token=QUERY-SECRET")
      .set("X-Request-Id", "private-request-id");
    await request(app).get("/api/v1/example/USER-987654321?secret=SECOND-SECRET");

    expect(metrics.completions).toHaveLength(2);
    expect(metrics.completions.every(({ route }) => route === "/api/v1/example/:id")).toBe(true);
    const output = JSON.stringify(metrics.completions);
    for (const privateValue of [
      "USER-123456789",
      "USER-987654321",
      "QUERY-SECRET",
      "SECOND-SECRET",
      "private-request-id",
    ]) expect(output).not.toContain(privateValue);
  });

  it("collapses arbitrary 404 paths into one bounded unmatched label", async () => {
    const { app, metrics } = createHarness();
    await Promise.all([
      request(app).get("/garbage/A"),
      request(app).get("/garbage/B"),
      request(app).get("/garbage/random-value?token=SECRET"),
    ]);

    expect(metrics.completions).toHaveLength(3);
    expect(new Set(metrics.completions.map(({ route }) => route))).toEqual(new Set(["unmatched"]));
    expect(JSON.stringify(metrics.completions)).not.toMatch(/garbage|random-value|SECRET/);
  });

  it("uses pre_route for CORS and mutation-origin rejection", async () => {
    const { app, metrics } = createHarness();
    const corsRejected = await request(app)
      .get("/api/v1/example/private-id")
      .set("Origin", "https://hostile.example");
    const mutationRejected = await request(app)
      .post("/api/v1/example/mutation/private-id")
      .set("Cookie", "session=opaque-secret");

    expect([corsRejected.status, mutationRejected.status]).toEqual([403, 403]);
    expect(metrics.completions).toMatchObject([
      { method: "GET", route: "pre_route", statusClass: "4xx" },
      { method: "POST", route: "pre_route", statusClass: "4xx" },
    ]);
    expect(JSON.stringify(metrics.completions)).not.toMatch(/hostile|opaque|private-id/);
  });

  it("keeps matched authentication rejection on its normalized route", async () => {
    const { app, metrics } = createHarness();
    const response = await request(app).get("/api/v1/example/unauthorized");

    expect(response.status).toBe(401);
    expect(metrics.completions).toMatchObject([{
      route: "/api/v1/example/unauthorized",
      statusClass: "4xx",
    }]);
  });

  it("emits only bounded status classes across success, redirect, rejection, and failure", async () => {
    const { app, metrics } = createHarness();
    const responses = await Promise.all([
      request(app).get("/api/v1/example/value"),
      request(app).get("/api/v1/example/redirect"),
      request(app).get("/api/v1/example/bad-request"),
      request(app).get("/api/v1/example/unauthorized"),
      request(app).get("/unknown"),
      request(app).get("/api/v1/example/failure"),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([200, 302, 400, 401, 404, 500]);
    expect(metrics.completions.map(({ statusClass }) => statusClass).sort()).toEqual([
      "2xx", "3xx", "4xx", "4xx", "4xx", "5xx",
    ]);
    expect(JSON.stringify(metrics.completions)).not.toMatch(/statusCode|"200"|"302"|"400"|"401"|"404"|"500"/);
  });

  it("includes healthy and unavailable health requests without changing health", async () => {
    const metrics = createCapturingMetrics();
    let ready = true;
    const app = createApp({
      originPolicy,
      environment: "test",
      metrics,
      readiness: () => ready,
    });

    const healthy = await request(app).get("/health");
    ready = false;
    const unhealthy = await request(app).get("/health");

    expect(healthy.status).toBe(200);
    expect(healthy.body).toEqual({ status: "ok" });
    expect(unhealthy.status).toBe(503);
    expect(unhealthy.body).toEqual({ status: "unavailable" });
    expect(metrics.completions).toMatchObject([
      { route: "/health", statusClass: "2xx" },
      { route: "/health", statusClass: "5xx" },
    ]);
  });

  it("tracks concurrent in-progress requests and returns the method gauge to zero", async () => {
    const metrics = createCapturingMetrics();
    const release = createDeferred();
    const bothEntered = createDeferred();
    let entered = 0;
    const router = Router();
    router.get("/wait/:id", async (_request, response) => {
      entered += 1;
      if (entered === 2) bothEntered.resolve();
      await release.promise;
      response.status(200).json({ ok: true });
    });
    const app = createApp({
      originPolicy,
      environment: "test",
      metrics,
      routes: [{ path: "/api/v1/example", router }],
    });

    const first = request(app).get("/api/v1/example/wait/A").set("X-Request-Id", "request-A");
    const second = request(app).get("/api/v1/example/wait/B").set("X-Request-Id", "request-B");
    const responses = Promise.all([first, second]);
    await bothEntered.promise;
    expect(metrics.inProgress.get("GET")).toBe(2);
    release.resolve();
    await responses;

    expect(metrics.inProgress.get("GET")).toBe(0);
    expect(metrics.completions).toHaveLength(2);
    expect(metrics.completions.every(({ route }) => route === "/api/v1/example/wait/:id")).toBe(true);
    expect(JSON.stringify(metrics.completions)).not.toMatch(/request-A|request-B/);
  });

  it("isolates throwing start and completion implementations from ordinary responses", async () => {
    const startFailure: MetricsPort = {
      startHttpRequest: () => { throw new Error("metrics start secret"); },
      render: async () => { throw new Error("not used"); },
    };
    const completionFailure: MetricsPort = {
      startHttpRequest: () => ({
        complete: () => { throw new Error("metrics completion secret"); },
      }),
      render: async () => { throw new Error("not used"); },
    };

    for (const metrics of [startFailure, completionFailure]) {
      const { app } = createHarness(metrics);
      const response = await request(app).get("/api/v1/example/value");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    }
  });

  it("cleans up an aborted response exactly once using the authoritative close lifecycle", () => {
    const logger = createCapturingLogger("application");
    const metrics = createCapturingMetrics();
    const responseEmitter = new EventEmitter();
    const headers = new Map<string, string | number>();
    const response = Object.assign(responseEmitter, {
      statusCode: 200,
      writableFinished: false,
      locals: {},
      setHeader: (name: string, value: string | number) => headers.set(name, value),
      getHeader: (name: string) => headers.get(name),
    });
    const requestObject = { method: "GET", get: () => undefined, res: response };
    const clock = vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(14);
    const middleware = createHttpObservabilityMiddleware({
      logger,
      metrics,
      clock,
      generateRequestId: () => "generated-abort-id",
    });

    middleware(
      requestObject as unknown as Request,
      response as unknown as Response,
      () => undefined,
    );
    expect(metrics.inProgress.get("GET")).toBe(1);
    responseEmitter.emit("close");
    responseEmitter.emit("finish");

    expect(metrics.inProgress.get("GET")).toBe(0);
    expect(metrics.completions).toEqual([{
      method: "GET",
      route: "pre_route",
      statusClass: "2xx",
      durationSeconds: 0.004,
    }]);
  });

  it("classifies only the bounded HTTP status families", () => {
    expect([100, 200, 300, 400, 500].map(classifyHttpStatusClass)).toEqual([
      "1xx", "2xx", "3xx", "4xx", "5xx",
    ]);
    expect([99, 600, Number.NaN].map(classifyHttpStatusClass)).toEqual([
      "other", "other", "other",
    ]);
  });
});
