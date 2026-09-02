import type {
  HttpRequestMetricCompletion,
  MetricsPort,
} from "../../src/observability/metrics.port.js";
import type { LogHttpMethod } from "../../src/observability/log-event.types.js";

export type CapturedHttpMetric = HttpRequestMetricCompletion & {
  readonly method: LogHttpMethod;
};

export const createCapturingMetrics = (): MetricsPort & {
  readonly starts: LogHttpMethod[];
  readonly completions: CapturedHttpMetric[];
  readonly inProgress: ReadonlyMap<LogHttpMethod, number>;
} => {
  const starts: LogHttpMethod[] = [];
  const completions: CapturedHttpMetric[] = [];
  const active = new Map<LogHttpMethod, number>();

  return {
    starts,
    completions,
    get inProgress() {
      return active;
    },
    startHttpRequest: ({ method }) => {
      starts.push(method);
      active.set(method, (active.get(method) ?? 0) + 1);
      let completed = false;
      return {
        complete: (completion) => {
          if (completed) return;
          completed = true;
          active.set(method, Math.max(0, (active.get(method) ?? 0) - 1));
          completions.push({ method, ...completion });
        },
      };
    },
    render: async () => ({
      contentType: "text/plain; version=0.0.4; charset=utf-8",
      body: "captured_metrics 1\n",
    }),
  };
};
