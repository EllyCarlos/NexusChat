import type { Server as SocketServer } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCapturingLogger } from "./support/capturing-logger.js";

import { ApplicationError } from "../src/errors/application-error.js";
import {
  DISTRIBUTED_REALTIME_CONFIGURATION_ERROR,
  DISTRIBUTED_REALTIME_NOT_READY_ERROR,
  prepareSocketTransport,
  resolveSocketTransportMode,
  type SocketRedisAdapterDependencies,
} from "../src/infrastructure/redis/socket-io-redis-adapter.js";
import type {
  RedisLifecycleClient,
  RedisRuntime,
} from "../src/infrastructure/redis/redis-runtime.js";

const REDIS_URL = "rediss://redis-user:obvious-fake-secret@redis.example.test:6380";

type HarnessOptions = {
  adapterError?: Error;
  duplicateError?: Error;
  installError?: Error;
  publisherConnectError?: Error;
  publisherCloseError?: Error;
  subscriberConnectError?: Error;
  subscriberCloseError?: Error;
  publisherReadyAfterConnect?: boolean;
  subscriberReadyAfterConnect?: boolean;
};

const createHarness = ({
  adapterError,
  duplicateError,
  installError,
  publisherConnectError,
  publisherCloseError,
  subscriberConnectError,
  subscriberCloseError,
  publisherReadyAfterConnect = true,
  subscriberReadyAfterConnect = true,
}: HarnessOptions = {}) => {
  const order: string[] = [];
  let publisherReady = false;
  let subscriberReady = false;

  const createClient = (label: string): RedisLifecycleClient => ({
    get isOpen() {
      return label === "publisher" ? publisherReady : subscriberReady;
    },
    get isReady() {
      return label === "publisher" ? publisherReady : subscriberReady;
    },
    connect: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    destroy: vi.fn(),
  });
  const publisher = createClient("publisher");
  const subscriber = createClient("subscriber");

  const publisherRuntime: RedisRuntime = {
    client: publisher,
    get isOpen() {
      return publisherReady;
    },
    get isReady() {
      return publisherReady;
    },
    connect: vi.fn(async () => {
      order.push("publisher-connect");
      if (publisherConnectError) throw publisherConnectError;
      publisherReady = publisherReadyAfterConnect;
    }),
    close: vi.fn(async () => {
      order.push("publisher-close");
      publisherReady = false;
      if (publisherCloseError) throw publisherCloseError;
    }),
  };
  const subscriberRuntime: RedisRuntime = {
    client: subscriber,
    get isOpen() {
      return subscriberReady;
    },
    get isReady() {
      return subscriberReady;
    },
    connect: vi.fn(async () => {
      order.push("subscriber-connect");
      if (subscriberConnectError) throw subscriberConnectError;
      subscriberReady = subscriberReadyAfterConnect;
    }),
    close: vi.fn(async () => {
      order.push("subscriber-close");
      subscriberReady = false;
      if (subscriberCloseError) throw subscriberCloseError;
    }),
  };

  const createPublisher = vi.fn(() => {
    order.push("publisher-create");
    return publisher;
  });
  const duplicateSubscriber = vi.fn(() => {
    order.push("subscriber-duplicate");
    if (duplicateError) throw duplicateError;
    return subscriber;
  });
  const createRuntime = vi.fn((client: RedisLifecycleClient) =>
    client === publisher ? publisherRuntime : subscriberRuntime);
  const adapterConstructor = vi.fn();
  const createSocketAdapter = vi.fn(() => {
    order.push("adapter-create");
    if (adapterError) throw adapterError;
    return adapterConstructor;
  });
  const io = {
    adapter: vi.fn(() => {
      order.push("adapter-install");
      if (installError) throw installError;
      return io;
    }),
  };

  const dependencies: SocketRedisAdapterDependencies = {
    createPublisher,
    duplicateSubscriber,
    createRuntime,
    createAdapter: createSocketAdapter as unknown as SocketRedisAdapterDependencies["createAdapter"],
  };

  return {
    adapterConstructor,
    createPublisher,
    createRuntime,
    dependencies,
    duplicateSubscriber,
    io,
    order,
    publisher,
    publisherRuntime,
    setPublisherReady: (ready: boolean) => {
      publisherReady = ready;
    },
    setSubscriberReady: (ready: boolean) => {
      subscriberReady = ready;
    },
    subscriber,
    subscriberRuntime,
  };
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Socket transport mode policy", () => {
  it.each(["development", "test"] as const)(
    "selects local transport in %s when REDIS_URL is absent",
    (environment) => {
      expect(resolveSocketTransportMode({ environment })).toEqual({ kind: "local" });
    },
  );

  it.each(["development", "test", "production"] as const)(
    "selects distributed transport in %s when REDIS_URL is configured",
    (environment) => {
      expect(resolveSocketTransportMode({ environment, redisUrl: REDIS_URL })).toEqual({
        kind: "distributed",
        redisUrl: REDIS_URL,
      });
    },
  );

  it("rejects production without REDIS_URL using a credential-safe configuration error", () => {
    let thrown: unknown;
    try {
      resolveSocketTransportMode({ environment: "production" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApplicationError);
    expect(thrown).toMatchObject({
      code: DISTRIBUTED_REALTIME_CONFIGURATION_ERROR,
      statusCode: 500,
    });
    expect((thrown as Error).message).toContain("REDIS_URL");
    expect(JSON.stringify(thrown)).not.toContain("obvious-fake-secret");
  });
});

describe("Socket.IO Redis adapter runtime", () => {
  it("keeps local mode ready without creating Redis clients or installing an adapter", async () => {
    const harness = createHarness();

    const runtime = await prepareSocketTransport({
      io: harness.io as unknown as SocketServer,
      mode: { kind: "local" },
      dependencies: harness.dependencies,
    });

    expect(runtime.mode).toBe("local");
    expect(runtime.isReady).toBe(true);
    expect(harness.createPublisher).not.toHaveBeenCalled();
    expect(harness.duplicateSubscriber).not.toHaveBeenCalled();
    expect(harness.io.adapter).not.toHaveBeenCalled();
    expect(runtime.close()).toBe(runtime.close());
    await expect(runtime.close()).resolves.toBeUndefined();
  });

  it("connects publisher then subscriber before creating and installing the adapter", async () => {
    const harness = createHarness();

    const runtime = await prepareSocketTransport({
      io: harness.io as unknown as SocketServer,
      mode: { kind: "distributed", redisUrl: REDIS_URL },
      dependencies: harness.dependencies,
    });

    expect(harness.createPublisher).toHaveBeenCalledOnce();
    expect(harness.createPublisher).toHaveBeenCalledWith({ url: REDIS_URL });
    expect(harness.duplicateSubscriber).toHaveBeenCalledOnce();
    expect(harness.duplicateSubscriber).toHaveBeenCalledWith(harness.publisher);
    expect(harness.createRuntime).toHaveBeenNthCalledWith(1, harness.publisher);
    expect(harness.createRuntime).toHaveBeenNthCalledWith(2, harness.subscriber);
    expect(harness.order).toEqual([
      "publisher-create",
      "subscriber-duplicate",
      "publisher-connect",
      "subscriber-connect",
      "adapter-create",
      "adapter-install",
    ]);
    expect(harness.io.adapter).toHaveBeenCalledWith(harness.adapterConstructor);
    expect(runtime.mode).toBe("distributed");
    expect(runtime.isReady).toBe(true);

    harness.setSubscriberReady(false);
    expect(runtime.isReady).toBe(false);
    harness.setSubscriberReady(true);
    harness.setPublisherReady(false);
    expect(runtime.isReady).toBe(false);
  });

  it("closes subscriber then publisher exactly once", async () => {
    const harness = createHarness();
    const runtime = await prepareSocketTransport({
      io: harness.io as unknown as SocketServer,
      mode: { kind: "distributed", redisUrl: REDIS_URL },
      dependencies: harness.dependencies,
    });

    const firstClose = runtime.close();
    const secondClose = runtime.close();

    expect(secondClose).toBe(firstClose);
    await firstClose;
    expect(harness.subscriberRuntime.close).toHaveBeenCalledOnce();
    expect(harness.publisherRuntime.close).toHaveBeenCalledOnce();
    expect(harness.order.slice(-2)).toEqual(["subscriber-close", "publisher-close"]);
    expect(runtime.isReady).toBe(false);
  });

  it("attempts both client closes and caches a sanitized shutdown failure", async () => {
    const harness = createHarness({
      subscriberCloseError: new Error(`subscriber close leaked ${REDIS_URL}`),
    });
    const logger = createCapturingLogger("redis");
    const runtime = await prepareSocketTransport({
      io: harness.io as unknown as SocketServer,
      mode: { kind: "distributed", redisUrl: REDIS_URL },
      dependencies: harness.dependencies,
      logger,
    });

    const firstClose = runtime.close();
    const secondClose = runtime.close();

    expect(secondClose).toBe(firstClose);
    await expect(firstClose).rejects.toThrow("Socket.IO Redis adapter shutdown failed");
    expect(harness.subscriberRuntime.close).toHaveBeenCalledOnce();
    expect(harness.publisherRuntime.close).toHaveBeenCalledOnce();
    const output = JSON.stringify(logger.events);
    expect(output).toContain("redis.socket_transport_shutdown.failed");
    expect(output).toContain("subscriber");
    expect(output).not.toContain(REDIS_URL);
    expect(output).not.toContain("obvious-fake-secret");
  });

  it("cleans both clients and skips subscriber connection when publisher connection fails", async () => {
    const failure = new Error("publisher unavailable");
    const harness = createHarness({ publisherConnectError: failure });

    await expect(prepareSocketTransport({
      io: harness.io as unknown as SocketServer,
      mode: { kind: "distributed", redisUrl: REDIS_URL },
      dependencies: harness.dependencies,
    })).rejects.toBe(failure);

    expect(harness.subscriberRuntime.connect).not.toHaveBeenCalled();
    expect(harness.order).toEqual([
      "publisher-create",
      "subscriber-duplicate",
      "publisher-connect",
      "subscriber-close",
      "publisher-close",
    ]);
    expect(harness.io.adapter).not.toHaveBeenCalled();
  });

  it("closes a created publisher when subscriber duplication fails", async () => {
    const failure = new Error("subscriber duplication failed");
    const harness = createHarness({ duplicateError: failure });

    await expect(prepareSocketTransport({
      io: harness.io as unknown as SocketServer,
      mode: { kind: "distributed", redisUrl: REDIS_URL },
      dependencies: harness.dependencies,
    })).rejects.toBe(failure);

    expect(harness.publisherRuntime.connect).not.toHaveBeenCalled();
    expect(harness.subscriberRuntime.close).not.toHaveBeenCalled();
    expect(harness.publisherRuntime.close).toHaveBeenCalledOnce();
    expect(harness.order).toEqual([
      "publisher-create",
      "subscriber-duplicate",
      "publisher-close",
    ]);
    expect(harness.io.adapter).not.toHaveBeenCalled();
  });

  it("cleans subscriber and connected publisher when subscriber connection fails", async () => {
    const failure = new Error("subscriber unavailable");
    const harness = createHarness({ subscriberConnectError: failure });

    await expect(prepareSocketTransport({
      io: harness.io as unknown as SocketServer,
      mode: { kind: "distributed", redisUrl: REDIS_URL },
      dependencies: harness.dependencies,
    })).rejects.toBe(failure);

    expect(harness.order).toEqual([
      "publisher-create",
      "subscriber-duplicate",
      "publisher-connect",
      "subscriber-connect",
      "subscriber-close",
      "publisher-close",
    ]);
    expect(harness.io.adapter).not.toHaveBeenCalled();
  });

  it.each([
    ["adapter factory", { adapterError: new Error("adapter factory failed") }],
    ["adapter installation", { installError: new Error("adapter installation failed") }],
  ] as const)("cleans both clients when %s fails", async (_label, options) => {
    const failure = options.adapterError ?? options.installError;
    const harness = createHarness(options);

    await expect(prepareSocketTransport({
      io: harness.io as unknown as SocketServer,
      mode: { kind: "distributed", redisUrl: REDIS_URL },
      dependencies: harness.dependencies,
    })).rejects.toBe(failure);

    expect(harness.subscriberRuntime.close).toHaveBeenCalledOnce();
    expect(harness.publisherRuntime.close).toHaveBeenCalledOnce();
  });

  it("rejects resolved-but-unready clients before adapter creation", async () => {
    const harness = createHarness({ subscriberReadyAfterConnect: false });

    await expect(prepareSocketTransport({
      io: harness.io as unknown as SocketServer,
      mode: { kind: "distributed", redisUrl: REDIS_URL },
      dependencies: harness.dependencies,
    })).rejects.toMatchObject({
      code: DISTRIBUTED_REALTIME_NOT_READY_ERROR,
      statusCode: 500,
    });

    expect(harness.io.adapter).not.toHaveBeenCalled();
    expect(harness.subscriberRuntime.close).toHaveBeenCalledOnce();
    expect(harness.publisherRuntime.close).toHaveBeenCalledOnce();
  });

  it("preserves the startup error while sanitizing cleanup failures", async () => {
    const startupFailure = new Error("publisher connection failed");
    const harness = createHarness({
      publisherConnectError: startupFailure,
      publisherCloseError: new Error(`publisher close leaked ${REDIS_URL}`),
      subscriberCloseError: new Error(`subscriber close leaked ${REDIS_URL}`),
    });
    const logger = createCapturingLogger("redis");

    await expect(prepareSocketTransport({
      io: harness.io as unknown as SocketServer,
      mode: { kind: "distributed", redisUrl: REDIS_URL },
      dependencies: harness.dependencies,
      logger,
    })).rejects.toBe(startupFailure);

    const output = JSON.stringify(logger.events);
    expect(output).toContain("subscriber");
    expect(output).toContain("publisher");
    expect(output).not.toContain(REDIS_URL);
    expect(output).not.toContain("obvious-fake-secret");
  });
});
