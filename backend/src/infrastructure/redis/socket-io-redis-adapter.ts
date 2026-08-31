import { createAdapter } from "@socket.io/redis-adapter";
import type { Server as SocketServer } from "socket.io";

import { ApplicationError } from "../../errors/application-error.js";
import type { NodeEnvironment } from "../../schemas/env.schema.js";
import { logServerError } from "../../utils/safe-logger.utils.js";
import {
  createRedisClient,
  duplicateRedisClient,
  type NodeRedisClient,
  type RedisConnectionConfiguration,
} from "./redis-client.js";
import {
  createRedisRuntime,
  type RedisLifecycleClient,
  type RedisRuntime,
} from "./redis-runtime.js";

export const DISTRIBUTED_REALTIME_CONFIGURATION_ERROR =
  "DISTRIBUTED_REALTIME_CONFIGURATION_INVALID";
export const DISTRIBUTED_REALTIME_NOT_READY_ERROR =
  "DISTRIBUTED_REALTIME_NOT_READY";

export type SocketTransportMode =
  | { readonly kind: "local" }
  | { readonly kind: "distributed"; readonly redisUrl: string };

export interface SocketTransportRuntime {
  readonly mode: SocketTransportMode["kind"];
  readonly isReady: boolean;
  close(): Promise<void>;
}

type AdapterRedisClient = RedisLifecycleClient;
type AdapterFactory = typeof createAdapter;

export type SocketRedisAdapterDependencies = {
  createPublisher?: (configuration: RedisConnectionConfiguration) => AdapterRedisClient;
  duplicateSubscriber?: (publisher: AdapterRedisClient) => AdapterRedisClient;
  createRuntime?: (client: AdapterRedisClient) => RedisRuntime;
  createAdapter?: AdapterFactory;
};

type PrepareSocketTransportOptions = {
  io: SocketServer;
  mode: SocketTransportMode;
  dependencies?: SocketRedisAdapterDependencies;
};

export const resolveSocketTransportMode = ({
  environment,
  redisUrl,
}: {
  environment: NodeEnvironment;
  redisUrl?: string;
}): SocketTransportMode => {
  if (redisUrl) {
    return Object.freeze({ kind: "distributed", redisUrl });
  }

  if (environment === "production") {
    throw new ApplicationError({
      code: DISTRIBUTED_REALTIME_CONFIGURATION_ERROR,
      message: "REDIS_URL is required for distributed realtime in production.",
      statusCode: 500,
    });
  }

  return Object.freeze({ kind: "local" });
};

const createLocalSocketTransportRuntime = (): SocketTransportRuntime => {
  const closePromise = Promise.resolve();
  return Object.freeze({
    mode: "local" as const,
    isReady: true,
    close: () => closePromise,
  });
};

const closeRedisAdapterClients = async (
  subscriberRuntime: RedisRuntime | undefined,
  publisherRuntime: RedisRuntime | undefined,
): Promise<void> => {
  const failures: unknown[] = [];

  for (const [context, runtime] of [
    ["Socket.IO Redis subscriber shutdown failed.", subscriberRuntime],
    ["Socket.IO Redis publisher shutdown failed.", publisherRuntime],
  ] as const) {
    if (!runtime) continue;
    try {
      await runtime.close();
    } catch (error) {
      failures.push(error);
      logServerError(context, error);
    }
  }

  if (failures.length > 0) {
    throw new Error("Socket.IO Redis adapter shutdown failed");
  }
};

const createDistributedSocketTransportRuntime = ({
  publisherRuntime,
  subscriberRuntime,
}: {
  publisherRuntime: RedisRuntime;
  subscriberRuntime: RedisRuntime;
}): SocketTransportRuntime => {
  let closePromise: Promise<void> | undefined;

  return Object.freeze({
    mode: "distributed" as const,
    get isReady() {
      return publisherRuntime.isReady && subscriberRuntime.isReady;
    },
    close: () => {
      closePromise ??= closeRedisAdapterClients(subscriberRuntime, publisherRuntime);
      return closePromise;
    },
  });
};

export const prepareSocketTransport = async ({
  io,
  mode,
  dependencies = {},
}: PrepareSocketTransportOptions): Promise<SocketTransportRuntime> => {
  if (mode.kind === "local") {
    return createLocalSocketTransportRuntime();
  }

  const createPublisher = dependencies.createPublisher
    ?? ((configuration: RedisConnectionConfiguration) => createRedisClient(configuration));
  const duplicateSubscriber = dependencies.duplicateSubscriber
    ?? ((publisher: AdapterRedisClient) =>
      duplicateRedisClient(publisher as NodeRedisClient));
  const createRuntime = dependencies.createRuntime
    ?? ((client: AdapterRedisClient) => createRedisRuntime(client));
  const createSocketAdapter = dependencies.createAdapter ?? createAdapter;

  let publisher: AdapterRedisClient | undefined;
  let subscriber: AdapterRedisClient | undefined;
  let publisherRuntime: RedisRuntime | undefined;
  let subscriberRuntime: RedisRuntime | undefined;

  try {
    publisher = createPublisher({ url: mode.redisUrl });
    publisherRuntime = createRuntime(publisher);
    subscriber = duplicateSubscriber(publisher);
    subscriberRuntime = createRuntime(subscriber);

    await publisherRuntime.connect();
    await subscriberRuntime.connect();

    if (!publisherRuntime.isReady || !subscriberRuntime.isReady) {
      throw new ApplicationError({
        code: DISTRIBUTED_REALTIME_NOT_READY_ERROR,
        message: "Distributed realtime transport is not ready.",
        statusCode: 500,
      });
    }

    io.adapter(createSocketAdapter(publisher, subscriber));

    return createDistributedSocketTransportRuntime({
      publisherRuntime,
      subscriberRuntime,
    });
  } catch (error) {
    try {
      await closeRedisAdapterClients(subscriberRuntime, publisherRuntime);
    } catch {
      // Client-specific failures were already sanitized and logged.
    }
    throw error;
  }
};
