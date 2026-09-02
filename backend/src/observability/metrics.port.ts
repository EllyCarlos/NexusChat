import type { LogHttpMethod } from "./log-event.types.js";

export const HTTP_STATUS_CLASSES = [
  "1xx",
  "2xx",
  "3xx",
  "4xx",
  "5xx",
  "other",
] as const;

export type HttpStatusClass = typeof HTTP_STATUS_CLASSES[number];

export type HttpRequestMetricStart = {
  readonly method: LogHttpMethod;
};

export type HttpRequestMetricCompletion = {
  readonly route: string;
  readonly statusClass: HttpStatusClass;
  readonly durationSeconds: number;
};

export interface HttpRequestMetricLifecycle {
  complete(completion: HttpRequestMetricCompletion): void;
}

export type MetricsExposition = {
  readonly contentType: string;
  readonly body: string;
};

export interface MetricsPort {
  startHttpRequest(start: HttpRequestMetricStart): HttpRequestMetricLifecycle;
  render(): Promise<MetricsExposition>;
}
