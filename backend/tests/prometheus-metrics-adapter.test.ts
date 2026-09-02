import { Counter, Gauge, Histogram } from "prom-client";
import { describe, expect, it, vi } from "vitest";

import {
  createPrometheusMetricsAdapter,
  HTTP_REQUEST_DURATION_BUCKETS_SECONDS,
} from "../src/infrastructure/metrics/prometheus-metrics.adapter.js";

describe("Prometheus metrics adapter", () => {
  it("renders only the deliberate HTTP portfolio with exact names and labels", async () => {
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
    expect(exposition.body).not.toMatch(/process_|nodejs_|socket|redis|presence|provider/);
  });

  it("uses the fixed web latency buckets", () => {
    expect(HTTP_REQUEST_DURATION_BUCKETS_SECONDS).toEqual([
      0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
    ]);
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
