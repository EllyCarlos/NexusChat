import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  messageCreate: vi.fn(),
  unreadUpsert: vi.fn(),
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    message: {
      create: mocks.messageCreate,
    },
    unreadMessages: {
      upsert: mocks.unreadUpsert,
    },
  },
}));

import { prisma } from "../src/lib/prisma.lib.js";
import {
  createPrismaAttachmentRepository,
  prismaAttachmentRepository,
} from "../src/modules/attachments/infrastructure/prisma-attachment.repository.js";

const repository = createPrismaAttachmentRepository(prisma);

const ACTOR_ID = "actor-user";
const CHAT_ID = "chat-1";
const MESSAGE_ID = "message-1";
const RECIPIENT_ID = "member-1";

const ATTACHMENTS = [
  {
    publicId: "attachment-public-1",
    secureUrl: "https://media.example/attachment-1.png",
  },
  {
    publicId: "attachment-public-2",
    secureUrl: "https://media.example/attachment-2.pdf",
  },
];

describe("Prisma attachment repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("exports a composed singleton and requires no transaction surface", () => {
    expect(prismaAttachmentRepository).toBeDefined();
    expect(prisma).not.toHaveProperty("$transaction");
  });

  it("creates an attachment message with the exact persistence and public projection", async () => {
    const createdAt = new Date("2025-01-01T00:00:00.000Z");
    const updatedAt = new Date("2025-01-01T00:00:00.000Z");
    const message = {
      id: MESSAGE_ID,
      isTextMessage: true,
      textMessageContent: null,
      chatId: CHAT_ID,
      url: null,
      isPollMessage: false,
      audioUrl: null,
      isEdited: false,
      replyToMessageId: null,
      isPinned: false,
      createdAt,
      updatedAt,
      sender: {
        id: ACTOR_ID,
        username: "actor",
        avatar: "actor-avatar",
      },
      attachments: ATTACHMENTS.map(({ secureUrl }) => ({ secureUrl })),
      poll: null,
      reactions: [],
    };
    mocks.messageCreate.mockResolvedValueOnce(message);

    await expect(repository.createAttachmentMessage({
      actorId: ACTOR_ID,
      chatId: CHAT_ID,
      attachments: ATTACHMENTS,
    })).resolves.toBe(message);

    expect(mocks.messageCreate).toHaveBeenCalledOnce();
    expect(mocks.messageCreate).toHaveBeenCalledWith({
      data: {
        chatId: CHAT_ID,
        senderId: ACTOR_ID,
        attachments: {
          createMany: {
            data: [
              {
                cloudinaryPublicId: "attachment-public-1",
                secureUrl: "https://media.example/attachment-1.png",
              },
              {
                cloudinaryPublicId: "attachment-public-2",
                secureUrl: "https://media.example/attachment-2.pdf",
              },
            ],
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
    });
    expect(mocks.unreadUpsert).not.toHaveBeenCalled();
  });

  it("upserts one unread recipient with the exact composite key and legacy update/create split", async () => {
    mocks.unreadUpsert.mockResolvedValueOnce({ id: "unread-1" });

    await expect(repository.upsertUnreadMessage({
      actorId: ACTOR_ID,
      chatId: CHAT_ID,
      messageId: MESSAGE_ID,
      userId: RECIPIENT_ID,
    })).resolves.toBeUndefined();

    expect(mocks.unreadUpsert).toHaveBeenCalledOnce();
    expect(mocks.unreadUpsert).toHaveBeenCalledWith({
      where: {
        userId_chatId: {
          userId: RECIPIENT_ID,
          chatId: CHAT_ID,
        },
      },
      update: {
        count: {
          increment: 1,
        },
        senderId: ACTOR_ID,
      },
      create: {
        userId: RECIPIENT_ID,
        chatId: CHAT_ID,
        count: 1,
        senderId: ACTOR_ID,
        messageId: MESSAGE_ID,
      },
    });
    expect(mocks.messageCreate).not.toHaveBeenCalled();
  });

  it("passes Prisma failures through unchanged", async () => {
    const failure = new Error("database unavailable");
    mocks.messageCreate.mockRejectedValueOnce(failure);

    await expect(repository.createAttachmentMessage({
      actorId: ACTOR_ID,
      chatId: CHAT_ID,
      attachments: ATTACHMENTS,
    })).rejects.toBe(failure);
  });
});
