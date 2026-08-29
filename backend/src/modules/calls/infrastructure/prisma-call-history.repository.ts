import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../../lib/prisma.lib.js";
import type {
  CallHistoryRepository,
  CreateCallHistoryInput,
} from "../contracts/call-history.repository.js";

type CallHistoryPrismaClient = Pick<PrismaClient, "callHistory">;

const createCallHistory = (
  client: CallHistoryPrismaClient,
  input: CreateCallHistoryInput,
) => {
  if (input.kind === "missed") {
    return client.callHistory.create({
      data: {
        callerId: input.callerId,
        calleeId: input.calleeId,
        status: "MISSED",
        endedAt: input.endedAt,
        duration: input.duration,
      },
    });
  }

  return client.callHistory.create({
    data: {
      callerId: input.callerId,
      calleeId: input.calleeId,
    },
  });
};

export const createPrismaCallHistoryRepository = (
  client: CallHistoryPrismaClient,
): CallHistoryRepository => ({
  create: (input) => createCallHistory(client, input),

  update: async (input) => {
    await client.callHistory.update({
      where: { id: input.callHistoryId },
      data: input.data,
    });
  },
});

export const prismaCallHistoryRepository = createPrismaCallHistoryRepository(prisma);
