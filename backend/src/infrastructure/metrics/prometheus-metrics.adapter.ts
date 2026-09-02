import {
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";

import type {
  HttpRequestMetricCompletion,
  HttpRequestMetricStart,
  MetricsPort,
} from "../../observability/metrics.port.js";

export const HTTP_REQUEST_DURATION_BUCKETS_SECONDS = [
  0.005,
  0.01,
  0.025,
  0.05,
  0.1,
  0.25,
  0.5,
  1,
  2.5,
  5,
  10,
] as const;

const safely = (operation: () => void): boolean => {
  try {
    operation();
    return true;
  } catch {
    return false;
  }
};

const safeDuration = (durationSeconds: number): number =>
  Number.isFinite(durationSeconds) && durationSeconds >= 0 ? durationSeconds : 0;

export const createPrometheusMetricsAdapter = (): MetricsPort => {
  const registry = new Registry();
  const requestCounter = new Counter({
    name: "nexuschat_http_requests_total",
    help: "Total HTTP requests completed",
    labelNames: ["method", "route", "status_class"] as const,
    registers: [registry],
  });
  const requestDuration = new Histogram({
    name: "nexuschat_http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_class"] as const,
    buckets: [...HTTP_REQUEST_DURATION_BUCKETS_SECONDS],
    registers: [registry],
  });
  const requestsInProgress = new Gauge({
    name: "nexuschat_http_requests_in_progress",
    help: "HTTP requests currently in progress",
    labelNames: ["method"] as const,
    registers: [registry],
  });

  return Object.freeze({
    startHttpRequest: ({ method }: HttpRequestMetricStart) => {
      const gaugeIncremented = safely(() => requestsInProgress.inc({ method }));
      let completed = false;

      return Object.freeze({
        complete: ({
          route,
          statusClass,
          durationSeconds,
        }: HttpRequestMetricCompletion) => {
          if (completed) return;
          completed = true;

          if (gaugeIncremented) {
            safely(() => requestsInProgress.dec({ method }));
          }
          const labels = { method, route, status_class: statusClass };
          safely(() => requestCounter.inc(labels));
          safely(() => requestDuration.observe(labels, safeDuration(durationSeconds)));
        },
      });
    },
    render: async () => ({
      contentType: registry.contentType,
      body: await registry.metrics(),
    }),
  });
};
