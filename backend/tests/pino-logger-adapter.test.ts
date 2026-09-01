import { describe, expect, it, vi } from "vitest";

import {
  createPinoLogger,
  LOGGER_FAILURE_FALLBACK_MESSAGE,
} from "../src/infrastructure/logging/pino-logger.adapter.js";
import type { LogEventFields } from "../src/observability/log-event.types.js";

const createDestination = () => {
  const output: string[] = [];
  return {
    output,
    destination: {
      write(message: string) {
        output.push(message);
      },
    },
    records: () => output
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
};

describe("Pino LoggerPort adapter", () => {
  it("emits JSON with native time, numeric levels, safe base bindings, and events", () => {
    const capture = createDestination();
    const logger = createPinoLogger({
      environment: "production",
      runtimeMode: "distributed",
      component: "bootstrap",
      minimumLevel: "debug",
      destination: capture.destination,
    });

    logger.debug("bootstrap.logger.debugged");
    logger.info("bootstrap.logger.informed");
    logger.warn("bootstrap.logger.warned");
    logger.error("bootstrap.logger.failed");

    const records = capture.records();
    expect(records.map(({ level }) => level)).toEqual([20, 30, 40, 50]);
    expect(records.map(({ event }) => event)).toEqual([
      "bootstrap.logger.debugged",
      "bootstrap.logger.informed",
      "bootstrap.logger.warned",
      "bootstrap.logger.failed",
    ]);
    for (const record of records) {
      expect(record.time).toEqual(expect.any(Number));
      expect(record.service).toBe("nexuschat-backend");
      expect(record.environment).toBe("production");
      expect(record.runtimeMode).toBe("distributed");
      expect(record.component).toBe("bootstrap");
      expect(record).not.toHaveProperty("timestamp");
      expect(record).not.toHaveProperty("pid");
      expect(record).not.toHaveProperty("hostname");
    }
  });

  it("binds a new component through the provider-neutral child boundary", () => {
    const capture = createDestination();
    const logger = createPinoLogger({
      environment: "development",
      runtimeMode: "local",
      component: "bootstrap",
      destination: capture.destination,
    });

    logger.forComponent("redis").info("redis.runtime.ready", {
      operation: "connect",
      result: "available",
    });

    expect(capture.records()[0]).toMatchObject({
      service: "nexuschat-backend",
      environment: "development",
      runtimeMode: "local",
      component: "redis",
      event: "redis.runtime.ready",
      operation: "connect",
      result: "available",
    });
  });

  it("allowlists event fields before they reach Pino", () => {
    const capture = createDestination();
    const logger = createPinoLogger({
      environment: "production",
      runtimeMode: "distributed",
      component: "provider",
      destination: capture.destination,
    });
    const sensitive = "private-provider-token";
    const unsafeFields = {
      operation: "send",
      result: "failed",
      errorType: "Error",
      error: new Error(sensitive),
      message: sensitive,
      stack: sensitive,
      token: sensitive,
      authorization: sensitive,
      providerResponse: { body: sensitive },
    } as unknown as LogEventFields;

    logger.error("provider.delivery.failed", unsafeFields);

    const output = capture.output.join("");
    expect(capture.records()[0]).toMatchObject({
      operation: "send",
      result: "failed",
      errorType: "Error",
    });
    expect(output).not.toContain(sensitive);
    expect(output).not.toContain("stack");
    expect(output).not.toContain("providerResponse");
  });

  it("uses production info, development debug, and test silent defaults", () => {
    const production = createDestination();
    const development = createDestination();
    const test = createDestination();

    createPinoLogger({
      environment: "production",
      runtimeMode: "distributed",
      component: "test",
      destination: production.destination,
    }).debug("test.logger.debugged");
    createPinoLogger({
      environment: "development",
      runtimeMode: "local",
      component: "test",
      destination: development.destination,
    }).debug("test.logger.debugged");
    createPinoLogger({
      environment: "test",
      runtimeMode: "local",
      component: "test",
      destination: test.destination,
    }).error("test.logger.failed");

    expect(production.output).toEqual([]);
    expect(development.records()).toHaveLength(1);
    expect(test.output).toEqual([]);
  });

  it("contains destination failures and emits one static bounded fallback", () => {
    const fallback = vi.fn();
    const logger = createPinoLogger({
      environment: "production",
      runtimeMode: "distributed",
      component: "test",
      destination: {
        write() {
          throw new Error("destination contained a private credential");
        },
      },
      fallback,
    });

    expect(() => logger.error("test.logger.failed")).not.toThrow();
    expect(() => logger.error("test.logger.failed")).not.toThrow();
    expect(fallback).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledWith(LOGGER_FAILURE_FALLBACK_MESSAGE);
    expect(JSON.stringify(fallback.mock.calls)).not.toContain("credential");
  });

  it("contains serialization failures and does not expose their metadata", () => {
    const capture = createDestination();
    const fallback = vi.fn();
    const logger = createPinoLogger({
      environment: "production",
      runtimeMode: "distributed",
      component: "test",
      destination: capture.destination,
      fallback,
    });
    const fields = Object.create(null) as LogEventFields;
    Object.defineProperty(fields, "operation", {
      get: () => {
        throw new Error("private serialization detail");
      },
    });

    expect(() => logger.error("test.logger.failed", fields)).not.toThrow();
    expect(capture.output).toEqual([]);
    expect(fallback).toHaveBeenCalledWith(LOGGER_FAILURE_FALLBACK_MESSAGE);
    expect(JSON.stringify(fallback.mock.calls)).not.toContain("serialization detail");
  });

  it("contains fallback failure without recursion or caller impact", () => {
    const fallback = vi.fn(() => {
      throw new Error("fallback failed");
    });
    const logger = createPinoLogger({
      environment: "production",
      runtimeMode: "distributed",
      component: "test",
      destination: {
        write() {
          throw new Error("destination failed");
        },
      },
      fallback,
    });

    expect(() => logger.error("test.logger.failed")).not.toThrow();
    expect(() => logger.error("test.logger.failed")).not.toThrow();
    expect(fallback).toHaveBeenCalledOnce();
  });
});
