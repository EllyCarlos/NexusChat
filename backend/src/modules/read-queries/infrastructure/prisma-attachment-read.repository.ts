import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../../lib/prisma.lib.js";
import type { AttachmentReadRepository } from "../contracts/attachment-read.repository.js";
import type { ReadRepositoryPageInput } from "../contracts/read-query.types.js";

type AttachmentReadPrismaClient = Pick<PrismaClient, "attachment">;

export const attachmentListArguments = ({
  chatId,
  skip,
  take,
}: ReadRepositoryPageInput) => ({
  where: {
    message: {
      chatId,
    },
  },
  omit: {
    id: true,
    cloudinaryPublicId: true,
    messageId: true,
  },
  orderBy: {
    message: {
      createdAt: "desc",
    },
  },
  skip,
  take,
} as const satisfies Prisma.AttachmentFindManyArgs);

export const attachmentCountArguments = (chatId: string) => ({
  where: {
    message: {
      chatId,
    },
  },
} as const satisfies Prisma.AttachmentCountArgs);

export const createPrismaAttachmentReadRepository = (
  client: AttachmentReadPrismaClient,
): AttachmentReadRepository => ({
  listAttachments: (input) => client.attachment.findMany(attachmentListArguments(input)),
  countAttachments: (chatId) => client.attachment.count(attachmentCountArguments(chatId)),
});

export const prismaAttachmentReadRepository = createPrismaAttachmentReadRepository(prisma);
