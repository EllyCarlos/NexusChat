import { createClient } from "redis";
import { logServerError } from "../../utils/safe-logger.utils.js";

export type NodeRedisClient = ReturnType<typeof createClient>;

export type RedisConnectionConfiguration = {
  readonly url: string;
};

const observeRedisClient = (client: NodeRedisClient): NodeRedisClient => {
  client.on("error", (error) => {
    logServerError("Redis client error.", error);
  });

  return client;
};

export const createRedisClient = ({
  url,
}: RedisConnectionConfiguration): NodeRedisClient => observeRedisClient(createClient({ url }));

export const duplicateRedisClient = (client: NodeRedisClient): NodeRedisClient =>
  observeRedisClient(client.duplicate());
