import {
  createSocketConnectionStateRuntime,
  type RecurringTask,
} from "../../../src/infrastructure/redis/socket-connection-state.runtime.js";
import { createRedisSocketConnectionDirectory } from "../../../src/infrastructure/redis/redis-socket-connection-directory.js";

type OwnedConnection = {
  userId: string;
  socketId: string;
};

const redisUrl = process.env.NEXUSCHAT_LIVE_REDIS_URL;
const disposableAcknowledged =
  process.env.NEXUSCHAT_LIVE_REDIS_DISPOSABLE === "true";
const connectionsValue = process.env.NEXUSCHAT_LIVE_CRASH_CONNECTIONS;
const leaseTtlMilliseconds = Number(
  process.env.NEXUSCHAT_LIVE_CRASH_LEASE_TTL_MS,
);
const maintenanceIntervalMilliseconds = Number(
  process.env.NEXUSCHAT_LIVE_CRASH_MAINTENANCE_INTERVAL_MS,
);

if (!redisUrl || !disposableAcknowledged || !connectionsValue) {
  throw new Error("Crash-owner live prerequisites are missing.");
}

const parsedRedisUrl = new URL(redisUrl);
if (!['127.0.0.1', 'localhost', '::1'].includes(parsedRedisUrl.hostname)
  || parsedRedisUrl.username
  || parsedRedisUrl.password) {
  throw new Error("Crash-owner Redis must be disposable, local, and credential-free.");
}

if (!Number.isSafeInteger(leaseTtlMilliseconds)
  || leaseTtlMilliseconds <= 0
  || !Number.isSafeInteger(maintenanceIntervalMilliseconds)
  || maintenanceIntervalMilliseconds <= 0) {
  throw new Error("Crash-owner timing configuration is invalid.");
}

const connections = JSON.parse(connectionsValue) as OwnedConnection[];
if (!Array.isArray(connections)
  || connections.length === 0
  || connections.some(({ userId, socketId }) => !userId || !socketId)) {
  throw new Error("Crash-owner connection configuration is invalid.");
}

const scheduleRecurring = (callback: () => void): RecurringTask => {
  const timer = setInterval(callback, maintenanceIntervalMilliseconds);
  return {
    clear: () => clearInterval(timer),
    unref: () => timer.unref(),
  };
};

const state = createSocketConnectionStateRuntime({
  mode: { kind: "distributed", redisUrl },
  dependencies: {
    createDirectory: (executor) => createRedisSocketConnectionDirectory({
      executor,
      leaseTtlMilliseconds,
    }),
    scheduleRecurring,
  },
});

process.once("disconnect", () => process.exit(97));

try {
  await state.connect();
  await state.start({
    handleLostConnection: () => undefined,
    reconcilePresence: async () => undefined,
  });

  const registrations = [];
  for (const { userId, socketId } of connections) {
    registrations.push(await state.directory.add(userId, socketId));
  }
  process.send?.({
    type: "ready",
    pid: process.pid,
    registrations,
  });
} catch (error) {
  process.send?.({
    type: "error",
    errorType: error instanceof Error ? error.name : "UnknownError",
  });
  process.exit(1);
}
