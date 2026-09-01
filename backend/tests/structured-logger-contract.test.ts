import { describe, expect, it } from "vitest";

import {
  LOG_OPERATION_NAMES,
  MIGRATED_LOG_EVENT_NAMES,
  type LogEventFields,
} from "../src/observability/log-event.types.js";
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
      operation: "message_send",
      result: "succeeded",
      durationMs: 12.5,
      statusCode: 204,
      route: "/api/v1/chat/:id",
      method: "PATCH",
      stage: "http_listen",
      errorCategory: "domain",
      errorType: "ApplicationError",
      applicationCode: "CONFLICT",
      requestId: "request-123",
      provider: "firebase",
      rejectionReason: "connection_cap",
    });

    expect(logger.events[0]?.fields).toEqual({
      operation: "message_send",
      result: "succeeded",
      durationMs: 12.5,
      statusCode: 204,
      route: "/api/v1/chat/:id",
      method: "PATCH",
      stage: "http_listen",
      errorCategory: "domain",
      errorType: "ApplicationError",
      applicationCode: "CONFLICT",
      requestId: "request-123",
      provider: "firebase",
      rejectionReason: "connection_cap",
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

    expect(logger.events[0]?.fields).toEqual({});
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

  it("keeps event and operation catalogs unique, bounded, and identifier-free", () => {
    expect(new Set(MIGRATED_LOG_EVENT_NAMES).size).toBe(MIGRATED_LOG_EVENT_NAMES.length);
    expect(new Set(LOG_OPERATION_NAMES).size).toBe(LOG_OPERATION_NAMES.length);
    expect(LOG_OPERATION_NAMES).toEqual([
      "connection_registration",
      "message_send",
      "message_seen",
      "message_edit",
      "message_delete",
      "typing",
      "reaction_add",
      "reaction_delete",
      "poll_vote",
      "poll_vote_remove",
      "message_pin",
      "message_unpin",
      "call_user",
      "call_accept",
      "call_reject",
      "call_end",
      "callee_busy",
      "ice_candidate",
      "negotiation_needed",
      "negotiation_done",
      "rate_limit_check",
      "push_send",
      "email_send",
      "profile_provision",
    ]);
    expect(LOG_OPERATION_NAMES.every((operation) =>
      /^[a-z][a-z0-9_]*$/.test(operation)
      && !/[0-9]{6,}/.test(operation),
    )).toBe(true);
  });
});
