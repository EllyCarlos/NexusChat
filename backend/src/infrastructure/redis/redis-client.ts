import { createClient } from "redis";
import type { LoggerPort } from "../../observability/logger.port.js";
import { noopLogger } from "../../observability/noop-logger.js";
import { logSafeError } from "../../observability/safe-error.js";

export type NodeRedisClient = ReturnType<typeof createClient>;

export type RedisConnectionConfiguration = {
  readonly url: string;
};

const observeRedisClient = (
  client: NodeRedisClient,
  logger: LoggerPort,
): NodeRedisClient => {
  client.on("error", (error) => {
    logSafeError(logger, "redis.client.failed", error);
  });

  return client;
};

export const createRedisClient = ({
  url,
}: RedisConnectionConfiguration, logger: LoggerPort = noopLogger.forComponent("redis")):
NodeRedisClient => observeRedisClient(createClient({ url }), logger);

export const duplicateRedisClient = (
  client: NodeRedisClient,
  logger: LoggerPort = noopLogger.forComponent("redis"),
): NodeRedisClient => observeRedisClient(client.duplicate(), logger);
