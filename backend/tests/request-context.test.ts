import { describe, expect, it } from "vitest";

import { createRequestContextLogger } from "../src/observability/request-context-logger.js";
import {
  getRequestContext,
  getRequestId,
  runWithRequestContext,
} from "../src/observability/request-context.js";
import {
  isValidRequestId,
  REQUEST_ID_MAX_LENGTH,
  REQUEST_ID_PATTERN,
  selectRequestId,
} from "../src/observability/request-id.js";
import { createCapturingLogger } from "./support/capturing-logger.js";

describe("HTTP request context", () => {
  it("is unavailable outside a request scope", () => {
    expect(getRequestContext()).toBeUndefined();
    expect(getRequestId()).toBeUndefined();
  });

  it("survives nested Promise and timer work without retaining mutable metadata", async () => {
    const observed = await runWithRequestContext(
      { requestId: "request-nested-1" },
      async () => {
        expect(getRequestContext()).toEqual({ requestId: "request-nested-1" });
        expect(Object.isFrozen(getRequestContext())).toBe(true);
        await Promise.resolve();
        return new Promise<string | undefined>((resolve) => {
          setTimeout(() => resolve(getRequestId()), 0);
        });
      },
    );

    expect(observed).toBe("request-nested-1");
    expect(getRequestId()).toBeUndefined();
  });

  it("isolates concurrent asynchronous request scopes", async () => {
    const observe = (requestId: string, delay: number) => runWithRequestContext(
      { requestId },
      () => new Promise<string | undefined>((resolve) => {
        setTimeout(() => resolve(getRequestId()), delay);
      }),
    );

    await expect(Promise.all([
      observe("request-concurrent-a", 8),
      observe("request-concurrent-b", 1),
    ])).resolves.toEqual(["request-concurrent-a", "request-concurrent-b"]);
    expect(getRequestId()).toBeUndefined();
  });

  it("enriches project logger fields only while a request context is active", () => {
    const capturingLogger = createCapturingLogger("http");
    const logger = createRequestContextLogger(capturingLogger);

    logger.info("http.request.completed", { result: "success" });
    runWithRequestContext({ requestId: "request-log-1" }, () => {
      logger.error("http.unexpected_request.failed", {
        errorType: "Error",
        requestId: "caller-cannot-override-context",
      });
    });

    expect(capturingLogger.events).toEqual([
      {
        level: "info",
        component: "http",
        event: "http.request.completed",
        fields: { result: "success" },
      },
      {
        level: "error",
        component: "http",
        event: "http.unexpected_request.failed",
        fields: { errorType: "Error", requestId: "request-log-1" },
      },
    ]);
  });
});

describe("HTTP request ID selection", () => {
  it("preserves only strict bounded ASCII request IDs", () => {
    const accepted = [
      "a",
      "Request_ID-123.test",
      "x".repeat(REQUEST_ID_MAX_LENGTH),
    ];
    for (const value of accepted) {
      expect(isValidRequestId(value)).toBe(true);
      expect(REQUEST_ID_PATTERN.test(value)).toBe(true);
      expect(selectRequestId(value, () => "generated-id")).toBe(value);
    }
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["space", "request id"],
    ["newline", "request\nid"],
    ["carriage return", "request\rid"],
    ["quote", "request\"id"],
    ["unicode", "request-é"],
    ["path separator", "request/id"],
    ["JSON fragment", "{\"id\":1}"],
    ["too long", "x".repeat(REQUEST_ID_MAX_LENGTH + 1)],
  ])("replaces %s input without reflecting it", (_label, value) => {
    expect(isValidRequestId(value)).toBe(false);
    expect(selectRequestId(value, () => "generated-safe-id")).toBe("generated-safe-id");
  });
});
