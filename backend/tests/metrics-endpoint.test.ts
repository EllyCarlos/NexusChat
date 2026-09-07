import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { createPrometheusMetricsAdapter } from "../src/infrastructure/metrics/prometheus-metrics.adapter.js";
import { credentialsMatch } from "../src/middlewares/metrics-endpoint.middleware.js";
import type { MetricsPort } from "../src/observability/metrics.port.js";
import type { OriginPolicy } from "../src/security/origin-policy.js";
import { createCapturingLogger } from "./support/capturing-logger.js";

const METRICS_TOKEN = "obvious-fake-metrics-token-0123456789abcdef";
const originPolicy: OriginPolicy = {
  origins: ["https://trusted.example"],
  allows: (origin) => origin === undefined || origin === "https://trusted.example",
};

const createEnabledApp = ({
  metrics = createPrometheusMetricsAdapter(),
  logger = createCapturingLogger("application"),
}: {
  metrics?: MetricsPort;
  logger?: ReturnType<typeof createCapturingLogger>;
} = {}) => ({
  app: createApp({
    originPolicy,
    environment: "test",
    metrics,
    logger,
    metricsConfiguration: {
      enabled: true,
      bearerToken: METRICS_TOKEN,
    },
  }),
  metrics,
  logger,
});

describe("protected metrics endpoint", () => {
  it("is absent and follows the normal 404 contract when disabled", async () => {
    const response = await request(createApp({ originPolicy, environment: "test" }))
      .get("/metrics");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, message: "Route not found" });
  });

  it.each([
    undefined,
    "Basic opaque-value",
    "Bearer",
    "Bearer ",
    "bearer obvious-fake-metrics-token-0123456789abcdef",
    "Bearer malformed token",
    "Bearer wrong-token-with-safe-length-0123456789",
  ])("returns 401 for a missing or invalid authorization value: %s", async (authorization) => {
    const { app } = createEnabledApp();
    const pending = request(app).get("/metrics");
    if (authorization !== undefined) pending.set("Authorization", authorization);
    const response = await pending;

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ success: false, message: "Unauthorized" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(response.body)).not.toContain(METRICS_TOKEN);
  });

  it("renders the isolated Prometheus registry for the dedicated bearer credential", async () => {
    const { app } = createEnabledApp();
    await request(app).get("/");
    const response = await request(app)
      .get("/metrics")
      .set("Authorization", `Bearer ${METRICS_TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-type"]).toBe(
      "text/plain; version=0.0.4; charset=utf-8",
    );
    expect(response.text).toContain("nexuschat_http_requests_total");
    expect(response.text).toContain("nexuschat_http_request_duration_seconds");
    expect(response.text).toContain("nexuschat_http_requests_in_progress");
    expect(response.text).not.toContain(METRICS_TOKEN);
  });

  it("does not self-instrument repeated scrapes", async () => {
    const { app } = createEnabledApp();
    await request(app).get("/");
    const scrape = () => request(app)
      .get("/metrics")
      .set("Authorization", `Bearer ${METRICS_TOKEN}`);

    const first = await scrape();
    const second = await scrape();
    const counterLine = 'nexuschat_http_requests_total{method="GET",route="/",status_class="2xx"} 1';
    expect(first.text).toContain(counterLine);
    expect(second.text).toContain(counterLine);
    expect(second.text).not.toContain('route="/metrics"');
    expect(second.text).not.toContain("nexuschat_http_requests_total 3");
  });

  it("never logs or exposes the supplied credential", async () => {
    const logger = createCapturingLogger("application");
    const { app } = createEnabledApp({ logger });
    const invalidToken = "obvious-invalid-metrics-token-0123456789abcd";
    await request(app).get("/metrics").set("Authorization", `Bearer ${invalidToken}`);
    await request(app).get("/metrics").set("Authorization", `Bearer ${METRICS_TOKEN}`);

    const output = JSON.stringify(logger.events);
    expect(output).not.toContain(METRICS_TOKEN);
    expect(output).not.toContain(invalidToken);
    expect(output).not.toContain("Authorization");
    expect(output).not.toContain("Bearer");
  });

  it("keeps application CORS policy and adds no browser scrape exception", async () => {
    const { app } = createEnabledApp();
    const response = await request(app)
      .get("/metrics")
      .set("Origin", "https://hostile.example")
      .set("Authorization", `Bearer ${METRICS_TOKEN}`);

    expect(response.status).toBe(403);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns a bounded 503 only for rendering failure while normal traffic remains healthy", async () => {
    const brokenMetrics: MetricsPort = {
      startHttpRequest: () => ({ complete: () => undefined }),
      render: async () => { throw new Error("registry internals SECRET"); },
    };
    const { app } = createEnabledApp({ metrics: brokenMetrics });
    const scrape = await request(app)
      .get("/metrics")
      .set("Authorization", `Bearer ${METRICS_TOKEN}`);
    const ordinary = await request(app).get("/");
    const health = await request(app).get("/health");

    expect(scrape.status).toBe(503);
    expect(scrape.body).toEqual({ success: false, message: "Metrics unavailable" });
    expect(JSON.stringify(scrape.body)).not.toContain("SECRET");
    expect(ordinary.status).toBe(200);
    expect(ordinary.body).toEqual({ status: "ok" });
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: "ok" });
  });

  it("fails secure during composition when enabled without a credential", () => {
    expect(() => createApp({
      originPolicy,
      environment: "test",
      metricsConfiguration: { enabled: true },
    })).toThrow("Metrics bearer credential is required");
  });

  it("uses length-safe constant-time credential comparison", () => {
    expect(credentialsMatch(METRICS_TOKEN, METRICS_TOKEN)).toBe(true);
    expect(credentialsMatch("short", METRICS_TOKEN)).toBe(false);
    expect(credentialsMatch(`${METRICS_TOKEN}x`, METRICS_TOKEN)).toBe(false);
    expect(credentialsMatch("obvious-fake-metrics-token-0123456789abcdeg", METRICS_TOKEN)).toBe(false);
  });
});
