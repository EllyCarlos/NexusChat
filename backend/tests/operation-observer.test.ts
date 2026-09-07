import { describe, expect, it, vi } from "vitest";

import type { LoggerPort } from "../src/observability/logger.port.js";
import {
  emitOperationError,
  emitOperationLog,
  operationDuration,
  selectOperationLoggerComponent,
} from "../src/observability/operation-observer.js";
import { createCapturingLogger } from "./support/capturing-logger.js";

describe("bounded operation observer", () => {
  it("computes monotonic failure duration and clamps invalid elapsed values", () => {
    expect(operationDuration(10, () => 17.25)).toBe(7.25);
    expect(operationDuration(10, () => 9)).toBe(0);
    expect(operationDuration(10, () => Number.NaN)).toBe(0);
  });

  it("emits only bounded safe failure metadata", () => {
    const logger = createCapturingLogger("provider");
    const secret = "private-provider-token-and-message";

    emitOperationError(logger, "provider.push_delivery.failed", new Error(secret), {
      provider: "firebase",
      operation: "push_send",
      errorCategory: "provider",
      result: "failed",
      durationMs: 4,
    });

    expect(logger.events).toEqual([{
      level: "error",
      component: "provider",
      event: "provider.push_delivery.failed",
      fields: {
        provider: "firebase",
        operation: "push_send",
        errorCategory: "provider",
        result: "failed",
        durationMs: 4,
        errorType: "Error",
      },
    }]);
    expect(JSON.stringify(logger.events)).not.toContain(secret);
  });

  it("never lets logger or component-binding failure escape", () => {
    const throwFromLogger = vi.fn(() => {
      throw new Error("logger unavailable");
    });
    const throwingLogger: LoggerPort = {
      component: "application",
      forComponent: throwFromLogger,
      debug: throwFromLogger,
      info: throwFromLogger,
      warn: throwFromLogger,
      error: throwFromLogger,
    };

    expect(selectOperationLoggerComponent(throwingLogger, "provider")).toBe(throwingLogger);
    expect(() => emitOperationLog(
      throwingLogger,
      "error",
      "provider.push_delivery.failed",
      { operation: "push_send" },
    )).not.toThrow();
    expect(() => emitOperationError(
      throwingLogger,
      "provider.push_delivery.failed",
      new Error("private failure"),
      { operation: "push_send" },
    )).not.toThrow();
  });
});
