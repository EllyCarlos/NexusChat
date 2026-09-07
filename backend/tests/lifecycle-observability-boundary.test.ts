import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  LOG_LIFECYCLE_STAGES,
  LOG_REDIS_ROLES,
  LOG_REDIS_STATES,
  LOG_SHUTDOWN_REASONS,
  MIGRATED_LOG_EVENT_NAMES,
  type LogEventFields,
} from "../src/observability/log-event.types.js";
import { createCapturingLogger } from "./support/capturing-logger.js";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("lifecycle observability boundary", () => {
  it("catalogs only the bounded Phase 2E-5 lifecycle vocabulary", () => {
    expect(MIGRATED_LOG_EVENT_NAMES).toEqual(expect.arrayContaining([
      "bootstrap.startup.started",
      "bootstrap.startup_stage.started",
      "bootstrap.startup_stage.completed",
      "bootstrap.startup_stage.failed",
      "bootstrap.startup.completed",
      "bootstrap.shutdown.started",
      "bootstrap.shutdown_stage.started",
      "bootstrap.shutdown_stage.completed",
      "bootstrap.shutdown_stage.failed",
      "bootstrap.shutdown.completed",
      "bootstrap.shutdown.failed",
      "redis.runtime.connecting",
      "redis.runtime.ready",
      "redis.runtime.unavailable",
      "redis.runtime.recovered",
      "redis.runtime.closed",
      "redis.connection_maintenance.unavailable",
      "redis.connection_maintenance.recovered",
    ]));
    expect(MIGRATED_LOG_EVENT_NAMES).not.toContain("redis.client.failed");
    expect(MIGRATED_LOG_EVENT_NAMES).not.toContain("redis.connection_maintenance.failed");
    expect(MIGRATED_LOG_EVENT_NAMES).not.toContain("bootstrap.runtime.selected");
    expect(MIGRATED_LOG_EVENT_NAMES).not.toContain("bootstrap.server.listening");
  });

  it("keeps stages, Redis roles/states, and shutdown reasons finite and explicit", () => {
    expect(LOG_LIFECYCLE_STAGES).toHaveLength(16);
    expect(LOG_REDIS_ROLES).toEqual(["publisher", "subscriber", "command"]);
    expect(LOG_REDIS_STATES).toEqual([
      "connecting",
      "ready",
      "unavailable",
      "closed",
    ]);
    expect(LOG_SHUTDOWN_REASONS).toEqual([
      "manual",
      "sigterm",
      "sigint",
      "uncaught_exception",
      "unhandled_rejection",
      "startup_failure",
    ]);
  });

  it("drops unbounded lifecycle values even when a caller defeats the type", () => {
    const logger = createCapturingLogger("redis");
    logger.warn("redis.runtime.unavailable", {
      stage: "private/path/SECRET-ID",
      role: "redis://private-user:private-password@redis.invalid",
      state: "private-state",
      reason: "private-reason",
    } as unknown as LogEventFields);

    expect(logger.events[0]?.fields).toEqual({});
    expect(JSON.stringify(logger.events)).not.toContain("private");
  });

  it("keeps Pino at one adapter and lifecycle fields free of secret-bearing bags", () => {
    const files = [
      "src/bootstrap/start-server.ts",
      "src/bootstrap/shutdown.ts",
      "src/infrastructure/redis/redis-client.ts",
      "src/infrastructure/redis/socket-connection-state.runtime.ts",
      "src/observability/log-event.types.ts",
    ];
    const logFieldSource = source("src/observability/log-event.types.ts");
    for (const forbiddenField of [
      "redisUrl?:",
      "databaseUrl?:",
      "password?:",
      "secret?:",
      "token?:",
      "hostname?:",
      "userId?:",
      "socketId?:",
    ]) {
      expect(logFieldSource).not.toContain(forbiddenField);
    }

    const allSource = source("src/infrastructure/logging/pino-logger.adapter.ts");
    expect(allSource).toMatch(/from ["']pino["']/);
    for (const path of files) expect(source(path)).not.toMatch(/from ["']pino["']/);
  });
});
