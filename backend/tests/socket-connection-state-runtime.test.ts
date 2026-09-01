import { describe, expect, it, vi } from "vitest";

import {
  createSocketConnectionStateRuntime,
  DISTRIBUTED_CONNECTION_STATE_CLOSE_TIMEOUT_ERROR,
  DISTRIBUTED_CONNECTION_STATE_NOT_READY_ERROR,
  SOCKET_CONNECTION_MAINTENANCE_INTERVAL_MS,
  SOCKET_CONNECTION_STATE_CLOSE_TIMEOUT_MS,
  type RecurringTask,
} from "../src/infrastructure/redis/socket-connection-state.runtime.js";
import { SocketConnectionRegistry } from "../src/socket/connection-registry.js";
import { createCapturingLogger } from "./support/capturing-logger.js";

const createDistributedHarness = () => {
  const commandClient = {
    isOpen: false,
    isReady: false,
    connect: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    destroy: vi.fn(),
    eval: vi.fn(async () => undefined),
  };
  const commandRuntime = {
    client: commandClient,
    isOpen: false,
    isReady: true,
    connect: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const directory = {
    add: vi.fn(),
    remove: vi.fn(),
    getSockets: vi.fn(),
    getLatestSocket: vi.fn(),
    isOnline: vi.fn(),
    connectionCount: vi.fn(),
    onlineUserIds: vi.fn(),
    renewOwnedLeases: vi.fn(async () => ({
      renewedCount: 1,
      missingConnections: [],
    })),
    reapExpiredLeases: vi.fn(async () => ({
      processedCount: 0,
      moreExpired: false,
      transitions: [],
    })),
    listPendingPresence: vi.fn(async () => []),
    claimPresence: vi.fn(),
    getClaimedPresence: vi.fn(),
    completePresence: vi.fn(),
    releasePresence: vi.fn(),
    cleanupSettledPresence: vi.fn(async () => ({
      processedCount: 0,
      cleanedCount: 0,
      moreSettled: false,
    })),
  };
  let scheduledCallback: (() => void) | undefined;
  const recurringTask: RecurringTask = {
    clear: vi.fn(),
    unref: vi.fn(),
  };
  const scheduleRecurring = vi.fn((callback: () => void) => {
    scheduledCallback = callback;
    return recurringTask;
  });
  const createCommandClient = vi.fn(() => commandClient);
  const createRuntime = vi.fn(() => commandRuntime);
  const createDirectory = vi.fn(() => directory);
  const eventLimiter = {
    consume: vi.fn(async () => true),
    consumeAll: vi.fn(async () => true),
  };
  const createEventLimiter = vi.fn(() => eventLimiter);
  const logger = createCapturingLogger("redis");

  const runtime = createSocketConnectionStateRuntime({
    mode: { kind: "distributed", redisUrl: "redis://example.test" },
    dependencies: {
      createCommandClient,
      createRuntime,
      createDirectory,
      createEventLimiter,
      scheduleRecurring,
    },
    logger,
  });

  return {
    runtime,
    commandClient,
    commandRuntime,
    directory,
    createCommandClient,
    createRuntime,
    createDirectory,
    eventLimiter,
    createEventLimiter,
    scheduleRecurring,
    recurringTask,
    logger,
    getScheduledCallback: () => scheduledCallback,
  };
};

describe("Socket connection-state runtime", () => {
  it("uses the existing local registry without constructing Redis or a timer", async () => {
    const registry = new SocketConnectionRegistry();
    const createCommandClient = vi.fn();
    const scheduleRecurring = vi.fn();
    const runtime = createSocketConnectionStateRuntime({
      mode: { kind: "local" },
      dependencies: { localRegistry: registry, createCommandClient, scheduleRecurring },
    });

    expect(runtime.isReady).toBe(false);
    await runtime.connect();
    await runtime.start({
      reconcilePresence: vi.fn(),
      handleLostConnection: vi.fn(),
    });

    expect(runtime.isReady).toBe(true);
    expect(await runtime.directory.add("user-a", "socket-a")).toMatchObject({
      accepted: true,
      firstConnection: true,
    });
    expect(createCommandClient).not.toHaveBeenCalled();
    expect(scheduleRecurring).not.toHaveBeenCalled();
    await expect(runtime.eventLimiter.consume({
      namespace: "local-runtime",
      limit: 1,
      windowMs: 1_000,
    }, ["user-a"])).resolves.toBe(true);
  });

  it("constructs exactly one command client and becomes ready only after initial maintenance", async () => {
    const harness = createDistributedHarness();
    const reconcilePresence = vi.fn(async () => undefined);
    const handleLostConnection = vi.fn(async () => undefined);
    harness.directory.renewOwnedLeases.mockResolvedValueOnce({
      renewedCount: 0,
      missingConnections: [{ userId: "user-a", socketId: "socket-a" }],
    });
    harness.directory.listPendingPresence.mockResolvedValueOnce([{
      userId: "user-b",
      state: "offline",
      version: 4,
      sourceSocketId: "socket-b",
    }]);

    expect(harness.createCommandClient).toHaveBeenCalledOnce();
    expect(harness.createCommandClient).toHaveBeenCalledWith({
      url: "redis://example.test",
    });
    expect(harness.createRuntime).toHaveBeenCalledOnce();
    expect(harness.createRuntime).toHaveBeenCalledWith(harness.commandClient);
    expect(harness.createDirectory).toHaveBeenCalledOnce();
    expect(harness.createDirectory).toHaveBeenCalledWith(harness.commandClient);
    expect(harness.createEventLimiter).toHaveBeenCalledOnce();
    expect(harness.createEventLimiter).toHaveBeenCalledWith({
      executor: harness.commandClient,
    });
    expect(harness.runtime.eventLimiter).toBe(harness.eventLimiter);
    expect(harness.runtime.isReady).toBe(false);

    await harness.runtime.connect();
    await harness.runtime.start({ reconcilePresence, handleLostConnection });

    expect(harness.commandRuntime.connect).toHaveBeenCalledOnce();
    expect(handleLostConnection).toHaveBeenCalledWith({
      userId: "user-a",
      socketId: "socket-a",
    });
    expect(reconcilePresence).toHaveBeenCalledWith("user-b");
    expect(harness.directory.reapExpiredLeases).toHaveBeenCalledOnce();
    expect(harness.directory.cleanupSettledPresence).toHaveBeenCalledOnce();
    expect(harness.scheduleRecurring).toHaveBeenCalledWith(
      expect.any(Function),
      SOCKET_CONNECTION_MAINTENANCE_INTERVAL_MS,
    );
    expect(harness.recurringTask.unref).toHaveBeenCalledOnce();
    expect(harness.runtime.isReady).toBe(true);
  });

  it("does not overlap scheduled maintenance iterations", async () => {
    const harness = createDistributedHarness();
    await harness.runtime.connect();
    await harness.runtime.start({
      reconcilePresence: vi.fn(),
      handleLostConnection: vi.fn(),
    });

    let releaseRenewal!: () => void;
    harness.directory.renewOwnedLeases.mockImplementationOnce(() =>
      new Promise((resolve) => {
        releaseRenewal = () => resolve({ renewedCount: 1, missingConnections: [] });
      }));

    harness.getScheduledCallback()?.();
    harness.getScheduledCallback()?.();
    await Promise.resolve();
    expect(harness.directory.renewOwnedLeases).toHaveBeenCalledTimes(2);

    releaseRenewal();
    await vi.waitFor(() => {
      expect(harness.directory.reapExpiredLeases).toHaveBeenCalledTimes(2);
    });
  });

  it("shares concurrent startup and schedules exactly one maintenance timer", async () => {
    const harness = createDistributedHarness();
    let releaseRenewal!: () => void;
    harness.directory.renewOwnedLeases.mockImplementationOnce(() =>
      new Promise((resolve) => {
        releaseRenewal = () => resolve({ renewedCount: 1, missingConnections: [] });
      }));
    const callbacks = {
      reconcilePresence: vi.fn(async () => undefined),
      handleLostConnection: vi.fn(async () => undefined),
    };
    await harness.runtime.connect();

    const firstStart = harness.runtime.start(callbacks);
    const secondStart = harness.runtime.start({
      reconcilePresence: vi.fn(async () => undefined),
      handleLostConnection: vi.fn(async () => undefined),
    });

    expect(secondStart).toBe(firstStart);
    expect(harness.directory.renewOwnedLeases).toHaveBeenCalledOnce();
    releaseRenewal();
    await Promise.all([firstStart, secondStart]);

    expect(harness.directory.reapExpiredLeases).toHaveBeenCalledOnce();
    expect(harness.directory.cleanupSettledPresence).toHaveBeenCalledOnce();
    expect(harness.scheduleRecurring).toHaveBeenCalledOnce();
    expect(harness.recurringTask.unref).toHaveBeenCalledOnce();
    expect(harness.runtime.isReady).toBe(true);
  });

  it("continues later presence users and cleanup after one reconciliation fails", async () => {
    const harness = createDistributedHarness();
    const failure = new Error("private reconciliation failure");
    const reconcilePresence = vi.fn(async (userId: string) => {
      if (userId === "user-a") throw failure;
    });
    const callbacks = {
      reconcilePresence,
      handleLostConnection: vi.fn(async () => undefined),
    };
    harness.directory.listPendingPresence
      .mockResolvedValueOnce([
        {
          userId: "user-a",
          state: "offline",
          version: 1,
          sourceSocketId: "socket-a",
        },
        {
          userId: "user-b",
          state: "online",
          version: 2,
          sourceSocketId: "socket-b",
        },
      ])
      .mockResolvedValueOnce([]);
    await harness.runtime.connect();

    await expect(harness.runtime.start(callbacks)).rejects.toBe(failure);

    expect(reconcilePresence.mock.calls).toEqual([["user-a"], ["user-b"]]);
    expect(harness.directory.cleanupSettledPresence).toHaveBeenCalledOnce();
    expect(harness.scheduleRecurring).not.toHaveBeenCalled();
    expect(harness.runtime.isReady).toBe(false);

    await harness.runtime.start(callbacks);

    expect(harness.directory.cleanupSettledPresence).toHaveBeenCalledTimes(2);
    expect(harness.scheduleRecurring).toHaveBeenCalledOnce();
    expect(harness.runtime.isReady).toBe(true);
  });

  it("continues later lost-connection callbacks and cleanup after one callback fails", async () => {
    const harness = createDistributedHarness();
    const failure = new Error("private lost-connection failure");
    const handleLostConnection = vi.fn(async ({ userId }: { userId: string }) => {
      if (userId === "user-a") throw failure;
    });
    harness.directory.renewOwnedLeases.mockResolvedValueOnce({
      renewedCount: 0,
      missingConnections: [
        { userId: "user-a", socketId: "socket-a" },
        { userId: "user-b", socketId: "socket-b" },
      ],
    });
    await harness.runtime.connect();

    await expect(harness.runtime.start({
      reconcilePresence: vi.fn(async () => undefined),
      handleLostConnection,
    })).rejects.toBe(failure);

    expect(handleLostConnection.mock.calls).toEqual([
      [{ userId: "user-a", socketId: "socket-a" }],
      [{ userId: "user-b", socketId: "socket-b" }],
    ]);
    expect(harness.directory.reapExpiredLeases).toHaveBeenCalledOnce();
    expect(harness.directory.cleanupSettledPresence).toHaveBeenCalledOnce();
    expect(harness.runtime.isReady).toBe(false);
  });

  it("recovers readiness only after a scheduled iteration fully succeeds", async () => {
    const harness = createDistributedHarness();
    const failure = new Error("private scheduled reconciliation failure");
    let shouldFail = true;
    const reconcilePresence = vi.fn(async (userId: string) => {
      if (userId === "user-a" && shouldFail) {
        shouldFail = false;
        throw failure;
      }
    });
    await harness.runtime.connect();
    await harness.runtime.start({
      reconcilePresence,
      handleLostConnection: vi.fn(async () => undefined),
    });
    harness.directory.listPendingPresence
      .mockResolvedValueOnce([
        {
          userId: "user-a",
          state: "offline",
          version: 3,
          sourceSocketId: "socket-a",
        },
        {
          userId: "user-b",
          state: "online",
          version: 4,
          sourceSocketId: "socket-b",
        },
      ])
      .mockResolvedValueOnce([]);

    harness.getScheduledCallback()?.();
    await vi.waitFor(() => {
      expect(harness.directory.cleanupSettledPresence).toHaveBeenCalledTimes(2);
      expect(harness.runtime.isReady).toBe(false);
    });
    expect(reconcilePresence.mock.calls).toEqual([["user-a"], ["user-b"]]);
    expect(harness.logger.events.at(-1)).toMatchObject({
      event: "redis.connection_maintenance.unavailable",
      fields: { errorType: "Error" },
    });

    harness.getScheduledCallback()?.();
    await vi.waitFor(() => {
      expect(harness.directory.cleanupSettledPresence).toHaveBeenCalledTimes(3);
      expect(harness.runtime.isReady).toBe(true);
    });
    expect(harness.logger.events.at(-1)).toMatchObject({
      event: "redis.connection_maintenance.recovered",
      fields: { result: "recovered" },
    });
  });

  it("logs one unavailable transition for repeated maintenance failures and one recovery", async () => {
    const harness = createDistributedHarness();
    const callbacks = {
      reconcilePresence: vi.fn(async () => undefined),
      handleLostConnection: vi.fn(async () => undefined),
    };
    await harness.runtime.connect();
    await harness.runtime.start(callbacks);
    const privateFailure = new Error(
      "rediss://private-user:private-password@redis.example.test",
    );
    harness.directory.renewOwnedLeases
      .mockRejectedValueOnce(privateFailure)
      .mockRejectedValueOnce(privateFailure)
      .mockRejectedValueOnce(privateFailure);

    for (let failure = 1; failure <= 3; failure += 1) {
      harness.getScheduledCallback()?.();
      await vi.waitFor(() => {
        expect(harness.directory.renewOwnedLeases).toHaveBeenCalledTimes(1 + failure);
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    expect(harness.runtime.isReady).toBe(false);
    harness.getScheduledCallback()?.();
    await vi.waitFor(() => expect(harness.runtime.isReady).toBe(true));

    const transitionEvents = harness.logger.events.filter(({ event }) =>
      event.startsWith("redis.connection_maintenance."));
    expect(transitionEvents.map(({ event }) => event)).toEqual([
      "redis.connection_maintenance.unavailable",
      "redis.connection_maintenance.recovered",
    ]);
    expect(JSON.stringify(transitionEvents)).not.toContain("private-password");
  });

  it("stays unready when initial maintenance fails and does not schedule", async () => {
    const harness = createDistributedHarness();
    const failure = new Error("private command failure");
    harness.directory.renewOwnedLeases.mockRejectedValueOnce(failure);
    await harness.runtime.connect();

    await expect(harness.runtime.start({
      reconcilePresence: vi.fn(),
      handleLostConnection: vi.fn(),
    })).rejects.toBe(failure);
    expect(harness.runtime.isReady).toBe(false);
    expect(harness.scheduleRecurring).not.toHaveBeenCalled();
  });

  it("rejects startup when the command runtime is not ready after initial maintenance", async () => {
    const harness = createDistributedHarness();
    harness.commandRuntime.isReady = false;
    await harness.runtime.connect();

    await expect(harness.runtime.start({
      reconcilePresence: vi.fn(async () => undefined),
      handleLostConnection: vi.fn(async () => undefined),
    })).rejects.toMatchObject({
      code: DISTRIBUTED_CONNECTION_STATE_NOT_READY_ERROR,
    });

    expect(harness.directory.cleanupSettledPresence).toHaveBeenCalledOnce();
    expect(harness.scheduleRecurring).not.toHaveBeenCalled();
    expect(harness.runtime.isReady).toBe(false);
  });

  it("marks draining unready, stops one timer, waits in-flight work, and closes once", async () => {
    const harness = createDistributedHarness();
    await harness.runtime.connect();
    await harness.runtime.start({
      reconcilePresence: vi.fn(),
      handleLostConnection: vi.fn(),
    });

    let releaseRenewal!: () => void;
    harness.directory.renewOwnedLeases.mockImplementationOnce(() =>
      new Promise((resolve) => {
        releaseRenewal = () => resolve({ renewedCount: 1, missingConnections: [] });
      }));
    harness.getScheduledCallback()?.();
    await Promise.resolve();

    harness.runtime.markDraining();
    const firstClose = harness.runtime.close();
    const secondClose = harness.runtime.close();
    expect(firstClose).toBe(secondClose);
    expect(harness.runtime.isReady).toBe(false);
    expect(harness.recurringTask.clear).toHaveBeenCalledOnce();
    expect(harness.commandRuntime.close).not.toHaveBeenCalled();

    releaseRenewal();
    await firstClose;
    expect(harness.commandRuntime.close).toHaveBeenCalledOnce();
    expect(harness.commandClient.destroy).not.toHaveBeenCalled();
  });

  it("force-destroys and rejects generically when in-flight maintenance misses the close deadline", async () => {
    vi.useFakeTimers();
    let releaseRenewal: (() => void) | undefined;
    try {
      const harness = createDistributedHarness();
      await harness.runtime.connect();
      await harness.runtime.start({
        reconcilePresence: vi.fn(async () => undefined),
        handleLostConnection: vi.fn(async () => undefined),
      });
      harness.directory.renewOwnedLeases.mockImplementationOnce(() =>
        new Promise((resolve) => {
          releaseRenewal = () => resolve({ renewedCount: 1, missingConnections: [] });
        }));
      harness.getScheduledCallback()?.();
      await Promise.resolve();

      const firstClose = harness.runtime.close();
      const secondClose = harness.runtime.close();
      const closeRejection = expect(firstClose).rejects.toMatchObject({
        code: DISTRIBUTED_CONNECTION_STATE_CLOSE_TIMEOUT_ERROR,
        message: "Distributed connection-state shutdown timed out.",
      });
      expect(secondClose).toBe(firstClose);
      expect(harness.commandRuntime.close).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(SOCKET_CONNECTION_STATE_CLOSE_TIMEOUT_MS);
      await closeRejection;

      expect(harness.commandClient.destroy).toHaveBeenCalledOnce();
      expect(harness.commandRuntime.close).not.toHaveBeenCalled();
      expect(harness.runtime.isReady).toBe(false);
    } finally {
      releaseRenewal?.();
      await Promise.resolve();
      vi.useRealTimers();
    }
  });

  it("force-destroys when graceful command close misses the same deadline", async () => {
    vi.useFakeTimers();
    try {
      const harness = createDistributedHarness();
      await harness.runtime.connect();
      await harness.runtime.start({
        reconcilePresence: vi.fn(async () => undefined),
        handleLostConnection: vi.fn(async () => undefined),
      });
      harness.commandRuntime.close.mockImplementationOnce(() => new Promise(() => undefined));

      const close = harness.runtime.close();
      const closeRejection = expect(close).rejects.toMatchObject({
        code: DISTRIBUTED_CONNECTION_STATE_CLOSE_TIMEOUT_ERROR,
      });
      await Promise.resolve();
      expect(harness.commandRuntime.close).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(SOCKET_CONNECTION_STATE_CLOSE_TIMEOUT_MS);
      await closeRejection;

      expect(harness.commandClient.destroy).toHaveBeenCalledOnce();
      expect(harness.runtime.isReady).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("force-destroys the command client when graceful command shutdown rejects", async () => {
    const harness = createDistributedHarness();
    const closeFailure = new Error("private graceful close failure");
    harness.commandRuntime.close.mockRejectedValueOnce(closeFailure);
    await harness.runtime.connect();
    await harness.runtime.start({
      reconcilePresence: vi.fn(async () => undefined),
      handleLostConnection: vi.fn(async () => undefined),
    });

    const close = harness.runtime.close();
    await expect(close).rejects.toBe(closeFailure);

    expect(harness.commandRuntime.close).toHaveBeenCalledOnce();
    expect(harness.commandClient.destroy).toHaveBeenCalledOnce();
    expect(harness.runtime.close()).toBe(close);
  });
});
