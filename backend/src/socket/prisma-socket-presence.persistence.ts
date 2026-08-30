import type { PrismaClient } from "@prisma/client";

import { prisma } from "../lib/prisma.lib.js";
import type {
  ClaimedPresenceLoader,
  SocketPresencePersistencePort,
} from "./presence-reconciler.js";

type PresencePrismaClient = Pick<PrismaClient, "$transaction">;

type PrismaPresencePersistenceOptions = {
  client?: PresencePrismaClient;
  clock?: () => Date;
};

/**
 * Serializes presence writes on the PostgreSQL User row across backend nodes.
 * Current Redis truth is deliberately loaded only after the row lock is held.
 */
export const createPrismaSocketPresencePersistence = ({
  client = prisma,
  clock = () => new Date(),
}: PrismaPresencePersistenceOptions = {}): SocketPresencePersistencePort => ({
  applySerialized: async (
    userId: string,
    loadCurrentClaimedTruth: ClaimedPresenceLoader,
  ) => client.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
    `;

    const current = await loadCurrentClaimedTruth();
    if (!current) return undefined;

    await transaction.user.update({
      where: { id: userId },
      data: current.state === "online"
        ? { isOnline: true }
        : { isOnline: false, lastSeen: clock() },
    });
    return current;
  }),
});

export const prismaSocketPresencePersistence =
  createPrismaSocketPresencePersistence();
