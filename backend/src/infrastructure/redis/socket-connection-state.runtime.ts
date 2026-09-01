import type { SocketConnectionRegistry } from "../../socket/connection-registry.js";
import { ApplicationError } from "../../errors/application-error.js";
import { socketConnectionRegistry } from "../../socket/connection-registry.js";
import type { SocketConnectionDirectory } from "../../socket/connection-directory.js";
import type {
  OwnedSocketConnection,
  SocketConnectionStateMaintenance,
} from "../../socket/connection-state-maintenance.js";
import { createLocalSocketConnectionDirectory } from "../../socket/local-connection-directory.adapter.js";
import { createLocalSocketEventRateLimitProvider } from "../../socket/local-socket-event-rate-limit.adapter.js";
import type { SocketEventRateLimitPort } from "../../socket/socket-event-rate-limit.port.js";
import type { LoggerPort } from "../../observability/logger.port.js";
import { noopLogger } from "../../observability/noop-logger.js";
import { logSafeError } from "../../observability/safe-error.js";
import {
  createRedisClient,
  type NodeRedisClient,
  type RedisConnectionConfiguration,
} from "./redis-client.js";
import {
  createRedisRuntime,
  type RedisLifecycleClient,
  type RedisRuntime,
} from "./redis-runtime.js";
import {
  createRedisSocketConnectionDirectory,
  type RedisScriptExecutor,
} from "./redis-socket-connection-directory.js";
import { createRedisSocketEventRateLimitProvider } from "./redis-socket-event-rate-limit.js";
import type { SocketTransportMode } from "./socket-io-redis-adapter.js";

export const SOCKET_CONNECTION_MAINTENANCE_INTERVAL_MS = 30_000;
export const SOCKET_CONNECTION_STATE_CLOSE_TIMEOUT_MS = 10_000;
export const DISTRIBUTED_CONNECTION_STATE_NOT_READY_ERROR =
  "DISTRIBUTED_CONNECTION_STATE_NOT_READY";
export const DISTRIBUTED_CONNECTION_STATE_CLOSE_TIMEOUT_ERROR =
  "DISTRIBUTED_CONNECTION_STATE_CLOSE_TIMEOUT";

export type SocketConnectionMaintenanceCallbacks = {
  reconcilePresence(userId: string): Promise<void>;
  handleLostConnection(connection: OwnedSocketConnection): Promise<void> | void;
};

export interface SocketConnectionStateRuntime {
  readonly mode: SocketTransportMode["kind"];
  readonly directory: SocketConnectionDirectory;
  readonly eventLimiter: SocketEventRateLimitPort;
  readonly maintenance?: SocketConnectionStateMaintenance;
  readonly isReady: boolean;
  readonly isOperational: boolean;
  connect(): Promise<void>;
  start(callbacks: SocketConnectionMaintenanceCallbacks): Promise<void>;
  markDraining(): void;
  close(): Promise<void>;
}

export type RecurringTask = {
  clear(): void;
  unref(): void;
};

type StateRuntimeDependencies = {
  localRegistry?: SocketConnectionRegistry;
  createCommandClient?: (
    configuration: RedisConnectionConfiguration,
  ) => RedisLifecycleClient & RedisScriptExecutor;
  createRuntime?: (
    client: RedisLifecycleClient & RedisScriptExecutor,
  ) => RedisRuntime<RedisLifecycleClient & RedisScriptExecutor>;
  createDirectory?: (
    executor: RedisScriptExecutor,
  ) => SocketConnectionDirectory & SocketConnectionStateMaintenance;
  createEventLimiter?: (options: {
    executor: RedisLifecycleClient & RedisScriptExecutor;
  }) => SocketEventRateLimitPort;
  scheduleRecurring?: (
    callback: () => void,
    intervalMilliseconds: number,
  ) => RecurringTask;
};

type CreateStateRuntimeOptions = {
  mode: SocketTransportMode;
  dependencies?: StateRuntimeDependencies;
  logger?: LoggerPort;
};

const scheduleRecurringTask = (
  callback: () => void,
  intervalMilliseconds: number,
): RecurringTask => {
  const timer = setInterval(callback, intervalMilliseconds);
  return {
    clear: () => clearInterval(timer),
    unref: () => timer.unref(),
  };
};

const createLocalStateRuntime = (
  registry: SocketConnectionRegistry,
): SocketConnectionStateRuntime => {
  const directory = createLocalSocketConnectionDirectory(registry);
  const eventLimiter = createLocalSocketEventRateLimitProvider();
  let started = false;
  let draining = false;
  const closePromise = Promise.resolve();

  return Object.freeze({
    mode: "local" as const,
    directory,
    eventLimiter,
    maintenance: undefined,
    get isReady() {
      return started && !draining;
    },
    get isOperational() {
      return started && !draining;
    },
    connect: async () => undefined,
    start: async () => {
      started = true;
    },
    markDraining: () => {
      draining = true;
    },
    close: () => closePromise,
  });
};

const createDistributedStateRuntime = ({
  commandRuntime,
  directory,
  eventLimiter,
  scheduleRecurring,
  logger,
}: {
  commandRuntime: RedisRuntime;
  directory: SocketConnectionDirectory & SocketConnectionStateMaintenance;
  eventLimiter: SocketEventRateLimitPort;
  scheduleRecurring: NonNullable<StateRuntimeDependencies["scheduleRecurring"]>;
  logger: LoggerPort;
}): SocketConnectionStateRuntime => {
  let started = false;
  let operational = false;
  let draining = false;
  let scheduledTask: RecurringTask | undefined;
  let currentIteration: Promise<void> | undefined;
  let startPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let callbacks: SocketConnectionMaintenanceCallbacks | undefined;

  const runMaintenance = (): Promise<void> => {
    if (currentIteration) return currentIteration;

    currentIteration = (async () => {
      if (!callbacks || draining) return;

      let iterationFailed = false;
      let firstIterationFailure: unknown;
      const recordIterationFailure = (error: unknown) => {
        operational = false;
        if (!iterationFailed) firstIterationFailure = error;
        iterationFailed = true;
      };

      const renewal = await directory.renewOwnedLeases();
      for (const connection of renewal.missingConnections) {
        try {
          await callbacks.handleLostConnection(connection);
        } catch (error) {
          recordIterationFailure(error);
        }
      }

      await directory.reapExpiredLeases();
      const pendingPresence = await directory.listPendingPresence();
      for (const transition of pendingPresence) {
        try {
          await callbacks.reconcilePresence(transition.userId);
        } catch (error) {
          recordIterationFailure(error);
        }
      }
      await directory.cleanupSettledPresence();
      if (iterationFailed) throw firstIterationFailure;
      operational = true;
    })().finally(() => {
      currentIteration = undefined;
    });

    return currentIteration;
  };

  const runScheduledMaintenance = () => {
    void runMaintenance().catch((error) => {
      operational = false;
      logSafeError(logger, "redis.connection_maintenance.failed", error);
    });
  };

  return Object.freeze({
    mode: "distributed" as const,
    directory,
    eventLimiter,
    maintenance: directory,
    get isReady() {
      return commandRuntime.isReady && started && operational && !draining;
    },
    get isOperational() {
      return started && operational && !draining;
    },
    connect: async () => {
      await commandRuntime.connect();
    },
    start: (maintenanceCallbacks: SocketConnectionMaintenanceCallbacks) => {
      if (startPromise) return startPromise;
      if (started) return Promise.resolve();
      callbacks = maintenanceCallbacks;
      const startAttempt = (async () => {
        await runMaintenance();
        if (draining || !commandRuntime.isReady) {
          operational = false;
          throw new ApplicationError({
            code: DISTRIBUTED_CONNECTION_STATE_NOT_READY_ERROR,
            message: "Distributed connection state is not ready.",
            statusCode: 500,
          });
        }
        scheduledTask = scheduleRecurring(
          runScheduledMaintenance,
          SOCKET_CONNECTION_MAINTENANCE_INTERVAL_MS,
        );
        scheduledTask.unref();
        started = true;
      })();
      startPromise = startAttempt;
      void startAttempt.catch(() => {
        if (startPromise === startAttempt) startPromise = undefined;
      });
      return startAttempt;
    },
    markDraining: () => {
      draining = true;
      operational = false;
    },
    close: () => {
      if (closePromise) return closePromise;
      draining = true;
      operational = false;
      scheduledTask?.clear();
      const gracefulClose = (async () => {
        await currentIteration;
        await commandRuntime.close();
      })();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const closeTimeout = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new ApplicationError({
            code: DISTRIBUTED_CONNECTION_STATE_CLOSE_TIMEOUT_ERROR,
            message: "Distributed connection-state shutdown timed out.",
            statusCode: 500,
          }));
        }, SOCKET_CONNECTION_STATE_CLOSE_TIMEOUT_MS);
      });
      closePromise = Promise.race([gracefulClose, closeTimeout])
        .catch((error: unknown) => {
          try {
            commandRuntime.client.destroy();
          } catch (destroyError) {
            logSafeError(logger, "redis.connection_state_force_close.failed", destroyError);
          }
          throw error;
        })
        .finally(() => {
          if (timeout) clearTimeout(timeout);
        });
      return closePromise;
    },
  });
};

export const createSocketConnectionStateRuntime = ({
  mode,
  dependencies = {},
  logger = noopLogger.forComponent("redis"),
}: CreateStateRuntimeOptions): SocketConnectionStateRuntime => {
  if (mode.kind === "local") {
    return createLocalStateRuntime(
      dependencies.localRegistry ?? socketConnectionRegistry,
    );
  }

  const createCommandClient = dependencies.createCommandClient
    ?? ((configuration: RedisConnectionConfiguration) =>
      createRedisClient(configuration, logger) as NodeRedisClient);
  const createCommandRuntime = dependencies.createRuntime
    ?? ((client: RedisLifecycleClient & RedisScriptExecutor) =>
      createRedisRuntime(client));
  const createDirectory = dependencies.createDirectory
    ?? ((executor: RedisScriptExecutor) =>
      createRedisSocketConnectionDirectory({ executor }));
  const createEventLimiter = dependencies.createEventLimiter
    ?? createRedisSocketEventRateLimitProvider;
  const scheduleRecurring = dependencies.scheduleRecurring ?? scheduleRecurringTask;

  const commandClient = createCommandClient({ url: mode.redisUrl });
  const commandRuntime = createCommandRuntime(commandClient);
  const directory = createDirectory(commandClient);
  const eventLimiter = createEventLimiter({ executor: commandClient });

  return createDistributedStateRuntime({
    commandRuntime,
    directory,
    eventLimiter,
    scheduleRecurring,
    logger: logger.forComponent("redis"),
  });
};
