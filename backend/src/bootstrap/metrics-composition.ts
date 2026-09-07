import { createPrometheusMetricsAdapter } from "../infrastructure/metrics/prometheus-metrics.adapter.js";
import type { MetricsPort } from "../observability/metrics.port.js";
import { noopMetrics } from "../observability/noop-metrics.js";

export const createProcessMetrics = ({
  enabled,
}: {
  readonly enabled: boolean;
}): MetricsPort => enabled ? createPrometheusMetricsAdapter() : noopMetrics;
