import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chatFindMany: vi.fn(),
  messageFindMany: vi.fn(),
  messageCount: vi.fn(),
  attachmentFindMany: vi.fn(),
  attachmentCount: vi.fn(),
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    chat: {
      findMany: mocks.chatFindMany,
    },
    message: {
      findMany: mocks.messageFindMany,
      count: mocks.messageCount,
    },
    attachment: {
      findMany: mocks.attachmentFindMany,
      count: mocks.attachmentCount,
    },
  },
}));

import { prisma } from "../src/lib/prisma.lib.js";
import { createPrismaAttachmentReadRepository } from "../src/modules/read-queries/infrastructure/prisma-attachment-read.repository.js";
import { createPrismaChatReadRepository } from "../src/modules/read-queries/infrastructure/prisma-chat-read.repository.js";
import { createPrismaMessageReadRepository } from "../src/modules/read-queries/infrastructure/prisma-message-read.repository.js";

const USER_ID = "authenticated-user";
const CHAT_ID = "chat-1";

const chatRepository = createPrismaChatReadRepository(prisma);
const messageRepository = createPrismaMessageReadRepository(prisma);
const attachmentRepository = createPrismaAttachmentReadRepository(prisma);

describe("Prisma read-query repositories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("owns the exact chat-list membership filter and compatibility projection", async () => {
    const chats = [{ id: CHAT_ID }];
    mocks.chatFindMany.mockResolvedValue(chats);

    await expect(chatRepository.listChatsForUser(USER_ID)).resolves.toBe(chats);
    expect(mocks.chatFindMany).toHaveBeenCalledWith({
      where: {
        ChatMembers: {
          some: {
            userId: USER_ID,
          },
        },
      },
      omit: {
        avatarCloudinaryPublicId: true,
      },
      include: {
        ChatMembers: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatar: true,
                isOnline: true,
                publicKey: true,
                lastSeen: true,
                verificationBadge: true,
              },
            },
          },
          omit: {
            chatId: true,
            userId: true,
            id: true,
          },
        },
        UnreadMessages: {
          select: {
            count: true,
            message: {
              select: {
                isTextMessage: true,
                url: true,
                attachments: {
                  select: {
                    secureUrl: true,
                  },
                },
                isPollMessage: true,
                createdAt: true,
                textMessageContent: true,
              },
            },
            sender: {
              select: {
                id: true,
                username: true,
                avatar: true,
                isOnline: true,
                publicKey: true,
                lastSeen: true,
                verificationBadge: true,
              },
            },
          },
        },
        latestMessage: {
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
            poll: true,
            reactions: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    avatar: true,
                  },
                },
              },
              omit: {
                id: true,
                createdAt: true,
                updatedAt: true,
                userId: true,
                messageId: true,
              },
            },
          },
        },
      },
    });

    const query = mocks.chatFindMany.mock.calls[0]?.[0];
    expect(query.include.UnreadMessages).not.toHaveProperty("where");
    expect(query).not.toHaveProperty("orderBy");
    expect(query).not.toHaveProperty("skip");
    expect(query).not.toHaveProperty("take");
  });

  it("owns the exact message list and count queries", async () => {
    const messages = [{ id: "message-1" }];
    mocks.messageFindMany.mockResolvedValue(messages);
    mocks.messageCount.mockResolvedValue(21);

    await expect(messageRepository.listMessages({
      chatId: CHAT_ID,
      skip: 20,
      take: 20,
    })).resolves.toBe(messages);
    await expect(messageRepository.countMessages(CHAT_ID)).resolves.toBe(21);

    expect(mocks.messageFindMany).toHaveBeenCalledWith({
      where: {
        chatId: CHAT_ID,
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
          include: {
            votes: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    avatar: true,
                  },
                },
              },
              omit: {
                id: true,
                pollId: true,
                userId: true,
              },
            },
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
        replyToMessage: {
          select: {
            sender: {
              select: {
                id: true,
                username: true,
                avatar: true,
              },
            },
            id: true,
            textMessageContent: true,
            isPollMessage: true,
            url: true,
            audioUrl: true,
            attachments: {
              select: {
                secureUrl: true,
              },
            },
          },
        },
      },
      omit: {
        senderId: true,
        pollId: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      skip: 20,
      take: 20,
    });
    expect(mocks.messageCount).toHaveBeenCalledWith({
      where: {
        chatId: CHAT_ID,
      },
    });
  });

  it("owns the exact public attachment list and count queries", async () => {
    const attachments = [{ secureUrl: "https://media.example/attachment-1" }];
    mocks.attachmentFindMany.mockResolvedValue(attachments);
    mocks.attachmentCount.mockResolvedValue(7);

    await expect(attachmentRepository.listAttachments({
      chatId: CHAT_ID,
      skip: 6,
      take: 6,
    })).resolves.toBe(attachments);
    await expect(attachmentRepository.countAttachments(CHAT_ID)).resolves.toBe(7);

    expect(mocks.attachmentFindMany).toHaveBeenCalledWith({
      where: {
        message: {
          chatId: CHAT_ID,
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
      skip: 6,
      take: 6,
    });
    expect(mocks.attachmentCount).toHaveBeenCalledWith({
      where: {
        message: {
          chatId: CHAT_ID,
        },
      },
    });
  });

  it("does not wrap provider failures", async () => {
    const failure = new Error("read provider unavailable");
    mocks.messageFindMany.mockRejectedValue(failure);

    await expect(messageRepository.listMessages({
      chatId: CHAT_ID,
      skip: 0,
      take: 20,
    })).rejects.toBe(failure);
  });
});
