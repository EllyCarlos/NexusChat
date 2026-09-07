import { Counter, Gauge, Histogram } from "prom-client";
import { describe, expect, it, vi } from "vitest";

import {
  createPrometheusMetricsAdapter,
  HTTP_REQUEST_DURATION_BUCKETS_SECONDS,
  REALTIME_OPERATION_DURATION_BUCKETS_SECONDS,
  SOCKET_CONNECTION_DURATION_BUCKETS_SECONDS,
} from "../src/infrastructure/metrics/prometheus-metrics.adapter.js";

describe("Prometheus metrics adapter", () => {
  it("renders the existing HTTP portfolio with exact names and labels", async () => {
    const metrics = createPrometheusMetricsAdapter();
    const requestMetric = metrics.startHttpRequest({ method: "GET" });

    const active = await metrics.render();
    expect(active.contentType).toBe("text/plain; version=0.0.4; charset=utf-8");
    expect(active.body).toContain(
      'nexuschat_http_requests_in_progress{method="GET"} 1',
    );

    requestMetric.complete({
      route: "/api/v1/example/:id",
      statusClass: "2xx",
      durationSeconds: 0.025,
    });
    const exposition = await metrics.render();

    expect(exposition.body).toContain("# HELP nexuschat_http_requests_total Total HTTP requests completed");
    expect(exposition.body).toContain("# TYPE nexuschat_http_requests_total counter");
    expect(exposition.body).toContain(
      'nexuschat_http_requests_total{method="GET",route="/api/v1/example/:id",status_class="2xx"} 1',
    );
    expect(exposition.body).toContain("# TYPE nexuschat_http_request_duration_seconds histogram");
    expect(exposition.body).toContain(
      'nexuschat_http_request_duration_seconds_count{method="GET",route="/api/v1/example/:id",status_class="2xx"} 1',
    );
    expect(exposition.body).toContain(
      'nexuschat_http_requests_in_progress{method="GET"} 0',
    );
    expect(exposition.body).not.toMatch(/process_|nodejs_|nexuschat_provider/);
  });

  it("uses the fixed web latency buckets", () => {
    expect(HTTP_REQUEST_DURATION_BUCKETS_SECONDS).toEqual([
      0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
    ]);
  });

  it("uses deliberate long-lived connection and aggregate-operation buckets", () => {
    expect(SOCKET_CONNECTION_DURATION_BUCKETS_SECONDS).toEqual([
      1, 5, 15, 30, 60, 300, 900, 1_800, 3_600, 7_200, 21_600, 86_400,
    ]);
    expect(REALTIME_OPERATION_DURATION_BUCKETS_SECONDS).toEqual([
      0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25,
      0.5, 1, 2.5, 5, 10, 30,
    ]);
  });

  it("renders the bounded distributed realtime portfolio in the same registry", async () => {
    let now = 1_000;
    const metrics = createPrometheusMetricsAdapter({ clock: () => now });
    metrics.recordSocketConnectionAdmission({
      result: "accepted",
      reason: "none",
      userId: "USER_SECRET_123",
      socketId: "SOCKET_SECRET_456",
      chatId: "CHAT_SECRET_789",
      redisKey: "REDIS_SECRET_KEY",
      token: "TOKEN_SECRET_VALUE",
    } as never);
    metrics.recordSocketConnectionAdmission({
      result: "rejected",
      reason: "connection_cap",
    });
    const connection = metrics.startSocketConnection({ runtimeMode: "distributed" });
    metrics.recordSocketOperationFailure("message_send");
    metrics.recordSocketRateLimitRejection("typing");
    metrics.recordSocketRateLimitProviderFailure("redis");
    metrics.recordRedisRuntimeState({ role: "publisher", state: "connecting" });
    metrics.recordRedisRuntimeState({ role: "publisher", state: "ready" });
    const maintenance = metrics.startConnectionMaintenance();
    const presence = metrics.startPresenceReconciliation();

    now = 6_000;
    connection.complete();
    connection.complete();
    maintenance.complete("success");
    maintenance.complete("failed");
    presence.complete("failed");

    const output = (await metrics.render()).body;
    expect(output).toContain(
      'nexuschat_socket_connections_active{runtime_mode="distributed"} 0',
    );
    expect(output).toContain(
      'nexuschat_socket_connection_admissions_total{result="accepted",reason="none"} 1',
    );
    expect(output).toContain(
      'nexuschat_socket_connection_admissions_total{result="rejected",reason="connection_cap"} 1',
    );
    expect(output).toContain(
      'nexuschat_socket_connection_duration_seconds_count{runtime_mode="distributed"} 1',
    );
    expect(output).toContain(
      'nexuschat_socket_connection_duration_seconds_sum{runtime_mode="distributed"} 5',
    );
    expect(output).toContain(
      'nexuschat_socket_operation_failures_total{operation="message_send"} 1',
    );
    expect(output).toContain(
      'nexuschat_socket_rate_limit_rejections_total{operation="typing"} 1',
    );
    expect(output).toContain(
      'nexuschat_socket_rate_limit_provider_failures_total{provider="redis"} 1',
    );
    expect(output).toContain('nexuschat_redis_runtime_ready{role="publisher"} 1');
    expect(output).toContain(
      'nexuschat_redis_state_transitions_total{role="publisher",state="connecting"} 1',
    );
    expect(output).toContain(
      'nexuschat_redis_state_transitions_total{role="publisher",state="ready"} 1',
    );
    expect(output).toContain(
      'nexuschat_connection_maintenance_runs_total{result="success"} 1',
    );
    expect(output).toContain(
      'nexuschat_connection_maintenance_duration_seconds_sum{result="success"} 5',
    );
    expect(output).toContain(
      'nexuschat_presence_reconciliations_total{result="failed"} 1',
    );
    expect(output).toContain(
      'nexuschat_presence_reconciliation_duration_seconds_sum{result="failed"} 5',
    );
    expect(output).not.toMatch(
      /USER_SECRET_123|SOCKET_SECRET_456|CHAT_SECRET_789|REDIS_SECRET_KEY|TOKEN_SECRET_VALUE/,
    );
    expect(output).not.toMatch(/process_|nodejs_/);
  });

  it("keeps local mode free of Redis role series", async () => {
    const metrics = createPrometheusMetricsAdapter({ clock: () => 1_000 });
    metrics.startSocketConnection({ runtimeMode: "local" }).complete();

    const output = (await metrics.render()).body;
    expect(output).toContain(
      'nexuschat_socket_connections_active{runtime_mode="local"} 0',
    );
    expect(output).not.toMatch(/nexuschat_redis_runtime_ready\{role=/);
    expect(output).not.toMatch(/nexuschat_redis_state_transitions_total\{role=/);
  });

  it("normalizes a regressing monotonic clock and completes connection duration once", async () => {
    let now = 10_000;
    const metrics = createPrometheusMetricsAdapter({ clock: () => now });
    const connection = metrics.startSocketConnection({ runtimeMode: "local" });
    now = 9_000;

    connection.complete();
    connection.complete();

    const output = (await metrics.render()).body;
    expect(output).toContain(
      'nexuschat_socket_connection_duration_seconds_sum{runtime_mode="local"} 0',
    );
    expect(output).toContain(
      'nexuschat_socket_connection_duration_seconds_count{runtime_mode="local"} 1',
    );
  });

  it("keeps independent runtimes isolated without duplicate registration", async () => {
    const first = createPrometheusMetricsAdapter();
    const second = createPrometheusMetricsAdapter();

    first.startHttpRequest({ method: "POST" }).complete({
      route: "/first",
      statusClass: "2xx",
      durationSeconds: 0.1,
    });
    second.startHttpRequest({ method: "GET" }).complete({
      route: "/second",
      statusClass: "4xx",
      durationSeconds: 0.2,
    });

    const [firstOutput, secondOutput] = await Promise.all([
      first.render(),
      second.render(),
    ]);
    expect(firstOutput.body).toContain('route="/first"');
    expect(firstOutput.body).not.toContain('route="/second"');
    expect(secondOutput.body).toContain('route="/second"');
    expect(secondOutput.body).not.toContain('route="/first"');
  });

  it("completes a request lifecycle only once and safely normalizes invalid duration", async () => {
    const metrics = createPrometheusMetricsAdapter();
    const requestMetric = metrics.startHttpRequest({ method: "OTHER" });
    requestMetric.complete({ route: "unknown", statusClass: "other", durationSeconds: Number.NaN });
    requestMetric.complete({ route: "/duplicate", statusClass: "5xx", durationSeconds: 10 });

    const exposition = (await metrics.render()).body;
    expect(exposition).toContain(
      'nexuschat_http_requests_total{method="OTHER",route="unknown",status_class="other"} 1',
    );
    expect(exposition).toContain(
      'nexuschat_http_request_duration_seconds_sum{method="OTHER",route="unknown",status_class="other"} 0',
    );
    expect(exposition).not.toContain("/duplicate");
  });

  it("swallows gauge-start, counter, and histogram observation failures", () => {
    const gaugeIncrement = vi.spyOn(Gauge.prototype, "inc")
      .mockImplementationOnce(() => { throw new Error("gauge start failure"); });
    const counterIncrement = vi.spyOn(Counter.prototype, "incWithoutExemplar")
      .mockImplementationOnce(() => { throw new Error("counter failure"); });
    const histogramObserve = vi.spyOn(Histogram.prototype, "observeWithoutExemplar")
      .mockImplementationOnce(() => { throw new Error("histogram failure"); });
    const metrics = createPrometheusMetricsAdapter();

    expect(() => metrics.startHttpRequest({ method: "GET" }).complete({
      route: "/failure-isolated",
      statusClass: "5xx",
      durationSeconds: 1,
    })).not.toThrow();

    gaugeIncrement.mockRestore();
    counterIncrement.mockRestore();
    histogramObserve.mockRestore();
  });

  it("swallows gauge completion failure without skipping counter and duration", async () => {
    const metrics = createPrometheusMetricsAdapter();
    const requestMetric = metrics.startHttpRequest({ method: "PATCH" });
    const gaugeDecrement = vi.spyOn(Gauge.prototype, "dec")
      .mockImplementationOnce(() => { throw new Error("gauge completion failure"); });

    expect(() => requestMetric.complete({
      route: "/failure-isolated",
      statusClass: "2xx",
      durationSeconds: 0.5,
    })).not.toThrow();
    gaugeDecrement.mockRestore();

    const exposition = (await metrics.render()).body;
    expect(exposition).toContain(
      'nexuschat_http_requests_total{method="PATCH",route="/failure-isolated",status_class="2xx"} 1',
    );
    expect(exposition).toContain(
      'nexuschat_http_request_duration_seconds_count{method="PATCH",route="/failure-isolated",status_class="2xx"} 1',
    );
  });
});
