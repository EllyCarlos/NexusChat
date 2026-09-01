import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCapturingLogger } from "./support/capturing-logger.js";

const redisMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("redis", () => ({
  createClient: redisMocks.createClient,
}));

import {
  createRedisClient,
  duplicateRedisClient,
  type NodeRedisClient,
} from "../src/infrastructure/redis/redis-client.js";
import {
  createRedisRuntime,
  type RedisLifecycleClient,
} from "../src/infrastructure/redis/redis-runtime.js";

type FakeClientOptions = {
  connectError?: Error;
  closeError?: Error;
  open?: boolean;
  ready?: boolean;
};

const createFakeClient = ({
  connectError,
  closeError,
  open = false,
  ready = false,
}: FakeClientOptions = {}) => {
  let isOpen = open;
  let isReady = ready;
  const errorListeners: Array<(error: Error) => void> = [];

  const client = {
    get isOpen() {
      return isOpen;
    },
    get isReady() {
      return isReady;
    },
    on: vi.fn((event: string, listener: (error: Error) => void) => {
      if (event === "error") {
        errorListeners.push(listener);
      }
      return client;
    }),
    connect: vi.fn(async () => {
      if (connectError) {
        throw connectError;
      }
      isOpen = true;
      isReady = true;
      return client;
    }),
    close: vi.fn(async () => {
      if (closeError) {
        throw closeError;
      }
      isOpen = false;
      isReady = false;
    }),
    destroy: vi.fn(() => {
      isOpen = false;
      isReady = false;
    }),
    duplicate: vi.fn(),
  };

  return {
    client,
    errorListeners,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Redis client creation", () => {
  it("creates an observed client without connecting on creation", () => {
    const fake = createFakeClient();
    const configuration = Object.freeze({
      url: "rediss://redis-user:obvious-fake-password@redis.example.test:6380",
    });
    redisMocks.createClient.mockReturnValue(fake.client);

    const client = createRedisClient(configuration);

    expect(client).toBe(fake.client);
    expect(redisMocks.createClient).toHaveBeenCalledOnce();
    expect(redisMocks.createClient).toHaveBeenCalledWith({ url: configuration.url });
    expect(redisMocks.createClient.mock.calls[0][0]).not.toBe(configuration);
    expect(fake.client.on).toHaveBeenCalledOnce();
    expect(fake.client.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(fake.client.connect).not.toHaveBeenCalled();
  });

  it("observes a duplicated client without connecting it", () => {
    const source = createFakeClient();
    const duplicate = createFakeClient();
    source.client.duplicate.mockReturnValue(duplicate.client);

    const client = duplicateRedisClient(source.client as unknown as NodeRedisClient);

    expect(client).toBe(duplicate.client);
    expect(source.client.duplicate).toHaveBeenCalledOnce();
    expect(duplicate.client.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(duplicate.client.connect).not.toHaveBeenCalled();
  });

  it("registers safe error logging before the client connects", async () => {
    const fake = createFakeClient();
    const sensitiveUrl = "rediss://redis-user:obvious-fake-password@redis.example.test:6380";
    redisMocks.createClient.mockReturnValue(fake.client);
    const logger = createCapturingLogger("redis");

    const client = createRedisClient({ url: sensitiveUrl }, logger);
    const runtime = createRedisRuntime(client);
    await runtime.connect();

    expect(fake.client.on.mock.invocationCallOrder[0]).toBeLessThan(
      fake.client.connect.mock.invocationCallOrder[0],
    );
    expect(fake.errorListeners).toHaveLength(1);
    fake.errorListeners[0](new Error(`Connection failed for ${sensitiveUrl}`));

    const output = JSON.stringify(logger.events);
    expect(output).toContain("redis.client.failed");
    expect(output).toContain("errorType");
    expect(output).not.toContain(sensitiveUrl);
    expect(output).not.toContain("obvious-fake-password");
  });
});

describe("Redis runtime lifecycle", () => {
  it("delegates one connection for concurrent callers and exposes readiness", async () => {
    const fake = createFakeClient();
    const runtime = createRedisRuntime(fake.client);

    expect(runtime.isOpen).toBe(false);
    expect(runtime.isReady).toBe(false);

    const firstConnect = runtime.connect();
    const secondConnect = runtime.connect();

    expect(secondConnect).toBe(firstConnect);
    await firstConnect;
    expect(fake.client.connect).toHaveBeenCalledOnce();
    expect(runtime.isOpen).toBe(true);
    expect(runtime.isReady).toBe(true);
  });

  it("caches the initial connection rejection without starting an application retry", async () => {
    const connectionError = new Error("obvious fake connection failure");
    const fake = createFakeClient({ connectError: connectionError });
    const runtime = createRedisRuntime(fake.client);

    const connection = runtime.connect();

    await expect(connection).rejects.toBe(connectionError);
    const repeatedConnection = runtime.connect();
    expect(repeatedConnection).toBe(connection);
    await expect(repeatedConnection).rejects.toBe(connectionError);
    expect(fake.client.connect).toHaveBeenCalledOnce();
  });

  it("aborts a pending unopened connection and closes idempotently without reconnecting", async () => {
    const connectionError = new Error(
      "obvious fake connection failure with rediss://sentinel:secret@redis.example.test",
    );
    let rejectConnection: ((error: Error) => void) | undefined;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client: RedisLifecycleClient = {
      isOpen: false,
      isReady: false,
      connect: vi.fn(() => new Promise<void>((_resolve, reject) => {
        rejectConnection = reject;
      })),
      close: vi.fn(async () => undefined),
      destroy: vi.fn(() => {
        rejectConnection?.(connectionError);
      }),
    };
    const runtime = createRedisRuntime(client);

    const connection = runtime.connect();
    await vi.waitFor(() => expect(rejectConnection).toBeTypeOf("function"));

    const firstClose = runtime.close();
    const secondClose = runtime.close();

    expect(secondClose).toBe(firstClose);
    await expect(firstClose).resolves.toBeUndefined();
    await expect(connection).rejects.toBe(connectionError);
    expect(client.destroy).toHaveBeenCalledOnce();
    expect(client.close).not.toHaveBeenCalled();
    await expect(runtime.connect()).rejects.toThrow("Redis runtime is closed.");
    expect(client.connect).toHaveBeenCalledOnce();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("sentinel:secret");
    errorSpy.mockRestore();
  });

  it("disposes an unopened client and makes close idempotent", async () => {
    const fake = createFakeClient();
    const runtime = createRedisRuntime(fake.client);

    const firstClose = runtime.close();
    const secondClose = runtime.close();

    expect(secondClose).toBe(firstClose);
    await firstClose;
    expect(fake.client.destroy).toHaveBeenCalledOnce();
    expect(fake.client.close).not.toHaveBeenCalled();
    await expect(runtime.connect()).rejects.toThrow("Redis runtime is closed.");
    expect(fake.client.connect).not.toHaveBeenCalled();
  });

  it("gracefully closes an open client once", async () => {
    const fake = createFakeClient({ open: true, ready: true });
    const runtime = createRedisRuntime(fake.client);

    await Promise.all([runtime.close(), runtime.close(), runtime.close()]);

    expect(fake.client.close).toHaveBeenCalledOnce();
    expect(fake.client.destroy).not.toHaveBeenCalled();
    expect(runtime.isOpen).toBe(false);
    expect(runtime.isReady).toBe(false);
  });

  it("preserves a graceful close rejection while remaining idempotent", async () => {
    const closeError = new Error("obvious fake close failure");
    const fake = createFakeClient({ closeError, open: true, ready: true });
    const runtime = createRedisRuntime(fake.client as RedisLifecycleClient);

    const close = runtime.close();

    await expect(close).rejects.toBe(closeError);
    expect(runtime.close()).toBe(close);
    expect(fake.client.close).toHaveBeenCalledOnce();
    expect(fake.client.destroy).not.toHaveBeenCalled();
  });
});
