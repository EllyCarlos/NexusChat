import type {
  HttpRequestMetricLifecycle,
  MetricsPort,
} from "./metrics.port.js";

const noopHttpRequestMetricLifecycle: HttpRequestMetricLifecycle = Object.freeze({
  complete: () => undefined,
});

export const noopMetrics: MetricsPort = Object.freeze({
  startHttpRequest: () => noopHttpRequestMetricLifecycle,
  render: async () => ({
    contentType: "text/plain; version=0.0.4; charset=utf-8",
    body: "",
  }),
});
