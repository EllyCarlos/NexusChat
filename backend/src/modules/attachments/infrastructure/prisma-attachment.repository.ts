import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../../lib/prisma.lib.js";
import type { AttachmentRepository } from "../contracts/attachment.repository.js";

type AttachmentPrismaClient = Pick<
  PrismaClient,
  "message" | "unreadMessages"
>;

export const createPrismaAttachmentRepository = (
  client: AttachmentPrismaClient,
): AttachmentRepository => ({
  createAttachmentMessage: (input) => client.message.create({
    data: {
      chatId: input.chatId,
      senderId: input.actorId,
      attachments: {
        createMany: {
          data: input.attachments.map((attachment) => ({
            cloudinaryPublicId: attachment.publicId,
            secureUrl: attachment.secureUrl,
          })),
        },
      },
    },
    include: {
      sender: {
        select: {
          id: true,
          username: true,
          avatar: true,
        },
      },
      attachments: {
        select: {
          secureUrl: true,
        },
      },
      poll: {
        omit: {
          id: true,
        },
      },
      reactions: {
        select: {
          user: {
            select: {
              id: true,
              username: true,
              avatar: true,
            },
          },
          reaction: true,
        },
      },
    },
    omit: {
      senderId: true,
      pollId: true,
      audioPublicId: true,
    },
  }),

  upsertUnreadMessage: async (input) => {
    await client.unreadMessages.upsert({
      where: {
        userId_chatId: {
          userId: input.userId,
          chatId: input.chatId,
        },
      },
      update: {
        count: {
          increment: 1,
        },
        senderId: input.actorId,
      },
      create: {
        userId: input.userId,
        chatId: input.chatId,
        count: 1,
        senderId: input.actorId,
        messageId: input.messageId,
      },
    });
  },
});

export const prismaAttachmentRepository = createPrismaAttachmentRepository(prisma);
