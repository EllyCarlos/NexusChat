import { createClient } from "redis";
import type { LogRedisRole } from "../../observability/log-event.types.js";
import {
  emitLifecycleLog,
  getLifecycleErrorMetadata,
} from "../../observability/lifecycle-logger.js";
import type { LoggerPort } from "../../observability/logger.port.js";
import { noopLogger } from "../../observability/noop-logger.js";

export type NodeRedisClient = ReturnType<typeof createClient>;

export type RedisConnectionConfiguration = {
  readonly url: string;
};

type RedisLifecyclePhase =
  | "initial"
  | "connecting"
  | "ready"
  | "unavailable"
  | "closing"
  | "closed";

type RedisLifecycleObserver = {
  markConnecting(): void;
  markReady(): void;
  markUnavailable(error?: unknown): void;
  markClosing(): void;
  markClosed(): void;
};

const redisLifecycleObservers = new WeakMap<object, RedisLifecycleObserver>();

const observeRedisClient = (
  client: NodeRedisClient,
  logger: LoggerPort,
  role: LogRedisRole,
): NodeRedisClient => {
  let phase: RedisLifecyclePhase = "initial";
  let hasBeenReady = false;

  const observer: RedisLifecycleObserver = {
    markConnecting: () => {
      if (phase !== "initial") return;
      phase = "connecting";
      emitLifecycleLog(logger, "info", "redis.runtime.connecting", {
        role,
        state: "connecting",
        result: "started",
      });
    },
    markReady: () => {
      if (phase === "closing" || phase === "closed" || phase === "ready") return;
      const recovered = hasBeenReady;
      phase = "ready";
      hasBeenReady = true;
      emitLifecycleLog(
        logger,
        "info",
        recovered ? "redis.runtime.recovered" : "redis.runtime.ready",
        {
          role,
          state: "ready",
          result: recovered ? "recovered" : "available",
        },
      );
    },
    markUnavailable: (error?: unknown) => {
      if (phase === "closing" || phase === "closed" || phase === "unavailable") return;
      phase = "unavailable";
      emitLifecycleLog(logger, "warn", "redis.runtime.unavailable", {
        role,
        state: "unavailable",
        result: "unavailable",
        ...(error === undefined ? {} : getLifecycleErrorMetadata(error)),
      });
    },
    markClosing: () => {
      if (phase === "closed") return;
      phase = "closing";
    },
    markClosed: () => {
      if (phase === "closed") return;
      phase = "closed";
      emitLifecycleLog(logger, "info", "redis.runtime.closed", {
        role,
        state: "closed",
        result: "completed",
      });
    },
  };

  redisLifecycleObservers.set(client, observer);
  client.on("error", (error) => {
    observer.markUnavailable(error);
  });
  client.on("ready", observer.markReady);
  client.on("reconnecting", () => observer.markUnavailable());
  client.on("end", () => {
    if (phase === "closing" || phase === "closed") {
      observer.markClosed();
      return;
    }
    observer.markUnavailable();
  });

  return client;
};

export const markRedisClientConnecting = (client: object): void => {
  redisLifecycleObservers.get(client)?.markConnecting();
};

export const markRedisClientReady = (client: object): void => {
  redisLifecycleObservers.get(client)?.markReady();
};

export const markRedisClientUnavailable = (
  client: object,
  error?: unknown,
): void => {
  redisLifecycleObservers.get(client)?.markUnavailable(error);
};

export const markRedisClientClosing = (client: object): void => {
  redisLifecycleObservers.get(client)?.markClosing();
};

export const markRedisClientClosed = (client: object): void => {
  redisLifecycleObservers.get(client)?.markClosed();
};

export const createRedisClient = ({
  url,
}: RedisConnectionConfiguration,
logger: LoggerPort = noopLogger.forComponent("redis"),
role: LogRedisRole = "command",
): NodeRedisClient => observeRedisClient(createClient({ url }), logger, role);

export const duplicateRedisClient = (
  client: NodeRedisClient,
  logger: LoggerPort = noopLogger.forComponent("redis"),
  role: LogRedisRole = "subscriber",
): NodeRedisClient => observeRedisClient(client.duplicate(), logger, role);
