import { randomUUID } from "node:crypto";

import { prisma } from "../lib/prisma.lib.js";
import type { LoggerPort } from "../observability/logger.port.js";
import { noopLogger } from "../observability/noop-logger.js";
import { logSafeError } from "../observability/safe-error.js";
import type {
  SocketConnectionDirectory,
  SocketPresenceTransition,
} from "./connection-directory.js";
import {
  socketPresenceWriteQueue,
  type SocketPresenceWriteQueue,
} from "./connection-registry.js";
import type {
  SocketConnectionStateMaintenance,
} from "./connection-state-maintenance.js";
import {
  createSocketPresenceReconciler,
  type SocketPresencePersistencePort,
  type SocketPresencePublisherPort,
} from "./presence-reconciler.js";

export interface SocketPresenceCoordinator {
  reconcileTransition(transition: SocketPresenceTransition): Promise<void>;
  reconcileUser(userId: string): Promise<void>;
  reconcilePending(): Promise<number>;
  drain(): Promise<void>;
}

type LocalPresenceStore = {
  setOnline(userId: string): Promise<void>;
  setOffline(userId: string, lastSeen: Date): Promise<void>;
};

type LocalPresenceCoordinatorOptions = {
  directory: Pick<SocketConnectionDirectory, "isOnline">;
  publisher: SocketPresencePublisherPort;
  queue?: SocketPresenceWriteQueue;
  store?: LocalPresenceStore;
  clock?: () => Date;
  logger?: LoggerPort;
};

const prismaLocalPresenceStore: LocalPresenceStore = {
  setOnline: async (userId) => {
    await prisma.user.update({
      where: { id: userId },
      data: { isOnline: true },
    });
  },
  setOffline: async (userId, lastSeen) => {
    await prisma.user.update({
      where: { id: userId },
      data: { isOnline: false, lastSeen },
    });
  },
};

/** Preserves the original process-local serialized presence behavior. */
export const createLocalSocketPresenceCoordinator = ({
  directory,
  publisher,
  queue = socketPresenceWriteQueue,
  store = prismaLocalPresenceStore,
  clock = () => new Date(),
  logger = noopLogger.forComponent("presence"),
}: LocalPresenceCoordinatorOptions): SocketPresenceCoordinator => {
  const reconcileTransition = async (transition: SocketPresenceTransition) => {
    try {
      await queue.run(transition.userId, async () => {
        if (transition.state === "online") {
          await store.setOnline(transition.userId);
          return;
        }
        await store.setOffline(transition.userId, clock());
      });
    } catch (error) {
      logSafeError(
        logger,
        transition.state === "online"
          ? "presence.online_update.failed"
          : "presence.offline_update.failed",
        error,
      );
    }

    const isOnline = await directory.isOnline(transition.userId);
    if (isOnline !== (transition.state === "online")) return;
    await publisher.publishPresence(transition);
  };

  return Object.freeze({
    reconcileTransition,
    reconcileUser: async () => undefined,
    reconcilePending: async () => 0,
    drain: async () => undefined,
  });
};

type DistributedPresenceCoordinatorOptions = {
  maintenance: SocketConnectionStateMaintenance;
  persistence: SocketPresencePersistencePort;
  publisher: SocketPresencePublisherPort;
  tokenFactory?: () => string;
};

export const createDistributedSocketPresenceCoordinator = ({
  maintenance,
  persistence,
  publisher,
  tokenFactory = randomUUID,
}: DistributedPresenceCoordinatorOptions): SocketPresenceCoordinator => {
  const reconciler = createSocketPresenceReconciler({
    maintenance,
    persistence,
    publisher,
    tokenFactory,
  });

  return Object.freeze({
    reconcileTransition: async (
      { userId }: SocketPresenceTransition,
    ) => reconciler.reconcileUser(userId),
    reconcileUser: (userId: string) => reconciler.reconcileUser(userId),
    reconcilePending: () => reconciler.reconcilePending(),
    drain: () => reconciler.drain(),
  });
};
