import { describe, expect, it } from "vitest";

import type { LogEventFields } from "../src/observability/log-event.types.js";
import { createCapturingLogger } from "./support/capturing-logger.js";

describe("provider-neutral structured logger contract", () => {
  it("captures all four semantic levels with required event names", () => {
    const logger = createCapturingLogger("test");

    logger.debug("test.logger.debugged");
    logger.info("test.logger.informed");
    logger.warn("test.logger.warned");
    logger.error("test.logger.failed");

    expect(logger.events.map(({ level, event }) => ({ level, event }))).toEqual([
      { level: "debug", event: "test.logger.debugged" },
      { level: "info", event: "test.logger.informed" },
      { level: "warn", event: "test.logger.warned" },
      { level: "error", event: "test.logger.failed" },
    ]);
  });

  it("binds components without mutating the parent logger", () => {
    const logger = createCapturingLogger("bootstrap");
    const redisLogger = logger.forComponent("redis");

    logger.info("bootstrap.runtime.started");
    redisLogger.warn("redis.runtime.unavailable", { result: "unavailable" });

    expect(logger.component).toBe("bootstrap");
    expect(redisLogger.component).toBe("redis");
    expect(logger.events.map(({ component }) => component)).toEqual([
      "bootstrap",
      "redis",
    ]);
  });

  it("retains only explicitly allowed structured fields", () => {
    const logger = createCapturingLogger("http");
    logger.info("http.request.completed", {
      operation: "request.complete",
      result: "succeeded",
      durationMs: 12.5,
      statusCode: 204,
      route: "/api/v1/chat/:id",
      method: "PATCH",
      stage: "response",
      errorCategory: "domain",
      errorType: "ApplicationError",
      applicationCode: "CONFLICT",
      requestId: "request-123",
    });

    expect(logger.events[0]?.fields).toEqual({
      operation: "request.complete",
      result: "succeeded",
      durationMs: 12.5,
      statusCode: 204,
      route: "/api/v1/chat/:id",
      method: "PATCH",
      stage: "response",
      errorCategory: "domain",
      errorType: "ApplicationError",
      applicationCode: "CONFLICT",
      requestId: "request-123",
    });
  });

  it("drops forbidden arbitrary metadata even when a caller defeats the type", () => {
    const logger = createCapturingLogger("provider");
    const sensitiveValue = "private-provider-token";
    const unsafeFields = {
      operation: "delivery",
      error: new Error(sensitiveValue),
      message: sensitiveValue,
      stack: sensitiveValue,
      headers: { authorization: sensitiveValue },
      token: sensitiveValue,
      userId: sensitiveValue,
      providerResponse: { body: sensitiveValue },
    } as unknown as LogEventFields;

    logger.error("provider.delivery.failed", unsafeFields);

    expect(logger.events[0]?.fields).toEqual({ operation: "delivery" });
    expect(JSON.stringify(logger.events)).not.toContain(sensitiveValue);
  });

  it("is deterministic, resettable, test-local, and never throws on bad metadata", () => {
    const first = createCapturingLogger("test");
    const second = createCapturingLogger("test");
    const unsafeFields = Object.create(null) as LogEventFields;
    Object.defineProperty(unsafeFields, "operation", {
      get: () => {
        throw new Error("private getter failure");
      },
    });

    expect(() => first.error("test.logger.failed", unsafeFields)).not.toThrow();
    second.info("test.logger.informed");
    expect(first.events).toEqual([]);
    expect(second.events).toHaveLength(1);

    second.reset();
    expect(second.events).toEqual([]);
  });
});
