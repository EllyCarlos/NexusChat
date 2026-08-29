import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  chatFindUnique: vi.fn(),
  chatUpdate: vi.fn(),
  chatMembersFindMany: vi.fn(),
  chatMembersCreateMany: vi.fn(),
  chatMembersDeleteMany: vi.fn(),
  userFindMany: vi.fn(),
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    $transaction: mocks.transaction,
    chat: {
      findUnique: mocks.chatFindUnique,
      update: mocks.chatUpdate,
    },
    chatMembers: {
      findMany: mocks.chatMembersFindMany,
      createMany: mocks.chatMembersCreateMany,
      deleteMany: mocks.chatMembersDeleteMany,
    },
    user: {
      findMany: mocks.userFindMany,
    },
  },
}));

import { prisma } from "../src/lib/prisma.lib.js";
import {
  CHAT_MEMBER_PUBLIC_SELECT,
  createPrismaChatRepository,
  prismaChatRepository,
} from "../src/modules/chats/infrastructure/prisma-chat.repository.js";

const repository = createPrismaChatRepository(prisma);

const ACTOR_ID = "actor-user";
const CHAT_ID = "chat-1";
const MEMBER_IDS = ["member-1", "member-2", ACTOR_ID];

const MEMBER_PUBLIC_SELECT = {
  id: true,
  username: true,
  avatar: true,
  isOnline: true,
  publicKey: true,
  lastSeen: true,
  verificationBadge: true,
};

const BASIC_USER_SELECT = {
  id: true,
  username: true,
  avatar: true,
};

const CHAT_MEMBERS_PROJECTION = {
  include: {
    user: {
      select: MEMBER_PUBLIC_SELECT,
    },
  },
  omit: {
    chatId: true,
    userId: true,
    id: true,
  },
};

const LATEST_MESSAGE_PROJECTION = {
  include: {
    sender: {
      select: BASIC_USER_SELECT,
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
          select: BASIC_USER_SELECT,
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
};

const CREATED_CHAT_QUERY = {
  where: {
    id: CHAT_ID,
  },
  omit: {
    avatarCloudinaryPublicId: true,
  },
  include: {
    ChatMembers: CHAT_MEMBERS_PROJECTION,
    UnreadMessages: {
      where: {
        userId: ACTOR_ID,
      },
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
          select: MEMBER_PUBLIC_SELECT,
        },
      },
    },
    latestMessage: LATEST_MESSAGE_PROJECTION,
  },
};

const ADDED_MEMBERS_CHAT_QUERY = {
  where: {
    id: CHAT_ID,
  },
  omit: {
    avatarCloudinaryPublicId: true,
  },
  include: {
    ChatMembers: CHAT_MEMBERS_PROJECTION,
    latestMessage: LATEST_MESSAGE_PROJECTION,
  },
};

const calledBefore = (first: ReturnType<typeof vi.fn>, second: ReturnType<typeof vi.fn>) => {
  expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0]);
};

describe("Prisma chat mutation repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("exports the exact public member projection and composed singleton", () => {
    expect(CHAT_MEMBER_PUBLIC_SELECT).toEqual(MEMBER_PUBLIC_SELECT);
    expect(prismaChatRepository).toBeDefined();
  });

  it("creates the group and exact supplied member sequence in one callback transaction", async () => {
    const transactionChatCreate = vi.fn().mockResolvedValue({ id: CHAT_ID });
    const transactionMembersCreateMany = vi.fn().mockResolvedValue({ count: 3 });
    mocks.transaction.mockImplementationOnce(async (operation) => operation({
      chat: {
        create: transactionChatCreate,
      },
      chatMembers: {
        createMany: transactionMembersCreateMany,
      },
    }));

    await expect(repository.createGroupChatWithMembers({
      actorId: ACTOR_ID,
      avatar: "https://media.example/group.png",
      avatarCloudinaryPublicId: "group-avatar-public-id",
      memberIds: MEMBER_IDS,
      name: "Architecture",
    })).resolves.toEqual({ id: CHAT_ID });

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(transactionChatCreate).toHaveBeenCalledWith({
      data: {
        avatar: "https://media.example/group.png",
        avatarCloudinaryPublicId: "group-avatar-public-id",
        isGroupChat: true,
        adminId: ACTOR_ID,
        name: "Architecture",
      },
      select: {
        id: true,
      },
    });
    expect(transactionMembersCreateMany).toHaveBeenCalledWith({
      data: MEMBER_IDS.map((userId) => ({
        chatId: CHAT_ID,
        userId,
      })),
    });
    calledBefore(transactionChatCreate, transactionMembersCreateMany);
  });

  it("finds the created chat with the exact actor-specific projection", async () => {
    const createdChat = { id: CHAT_ID, UnreadMessages: [] };
    mocks.chatFindUnique.mockResolvedValueOnce(createdChat);

    await expect(repository.findCreatedGroupChat(CHAT_ID, ACTOR_ID)).resolves.toBe(createdChat);
    expect(mocks.chatFindUnique).toHaveBeenCalledWith(CREATED_CHAT_QUERY);
    expect(mocks.chatFindUnique.mock.calls[0]?.[0].include.UnreadMessages.where).toEqual({
      userId: ACTOR_ID,
    });
  });

  it("preserves the exact non-transactional add-member queries and projections", async () => {
    const publicMember = {
      id: "member-3",
      username: "member-three",
      avatar: "avatar",
      isOnline: false,
      publicKey: null,
      lastSeen: null,
      verificationBadge: false,
    };
    const updatedChat = { id: CHAT_ID };
    mocks.chatMembersFindMany
      .mockResolvedValueOnce([
        { user: { username: "existing-one" } },
        { user: { username: "existing-two" } },
      ])
      .mockResolvedValueOnce([
        { user: { id: ACTOR_ID } },
        { user: { id: "member-1" } },
      ]);
    mocks.chatMembersCreateMany.mockResolvedValueOnce({ count: 1 });
    mocks.userFindMany.mockResolvedValueOnce([publicMember]);
    mocks.chatFindUnique.mockResolvedValueOnce(updatedChat);

    await expect(repository.findExistingRequestedMemberUsernames(
      CHAT_ID,
      ["member-2", "member-3"],
    )).resolves.toEqual(["existing-one", "existing-two"]);
    await expect(repository.listMemberIdsForAddition(CHAT_ID)).resolves.toEqual([
      ACTOR_ID,
      "member-1",
    ]);
    await expect(repository.addMembers(CHAT_ID, ["member-3"])).resolves.toBeUndefined();
    await expect(repository.findMemberPublicDetails(["member-3"])).resolves.toEqual([
      publicMember,
    ]);
    await expect(repository.findChatForAddedMemberPayload(CHAT_ID)).resolves.toBe(updatedChat);

    expect(mocks.chatMembersFindMany).toHaveBeenNthCalledWith(1, {
      where: {
        chatId: CHAT_ID,
        userId: {
          in: ["member-2", "member-3"],
        },
      },
      include: {
        user: {
          select: {
            username: true,
          },
        },
      },
    });
    expect(mocks.chatMembersFindMany).toHaveBeenNthCalledWith(2, {
      where: {
        chatId: CHAT_ID,
      },
      include: {
        user: {
          select: {
            id: true,
          },
        },
      },
    });
    expect(mocks.chatMembersCreateMany).toHaveBeenCalledWith({
      data: [{ chatId: CHAT_ID, userId: "member-3" }],
    });
    expect(mocks.userFindMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["member-3"],
        },
      },
      select: MEMBER_PUBLIC_SELECT,
    });
    expect(mocks.chatFindUnique).toHaveBeenCalledWith(ADDED_MEMBERS_CHAT_QUERY);
    expect(mocks.chatFindUnique.mock.calls[0]?.[0].include).not.toHaveProperty("UnreadMessages");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("preserves the exact non-transactional removal reads and writes", async () => {
    mocks.chatMembersFindMany.mockResolvedValueOnce([
      { userId: ACTOR_ID },
      { userId: "member-1" },
      { userId: "member-2" },
    ]);
    mocks.chatUpdate.mockResolvedValueOnce({ id: CHAT_ID });
    mocks.chatMembersDeleteMany.mockResolvedValueOnce({ count: 1 });

    await expect(repository.listMemberIdsForRemoval(CHAT_ID)).resolves.toEqual([
      ACTOR_ID,
      "member-1",
      "member-2",
    ]);
    await expect(repository.updateAdmin(CHAT_ID, "member-1")).resolves.toBeUndefined();
    await expect(repository.deleteMembers(CHAT_ID, [ACTOR_ID])).resolves.toBeUndefined();

    expect(mocks.chatMembersFindMany).toHaveBeenCalledWith({
      where: {
        chatId: CHAT_ID,
      },
    });
    expect(mocks.chatUpdate).toHaveBeenCalledWith({
      where: {
        id: CHAT_ID,
      },
      data: {
        adminId: "member-1",
      },
    });
    expect(mocks.chatMembersDeleteMany).toHaveBeenCalledWith({
      where: {
        chatId: CHAT_ID,
        userId: {
          in: [ACTOR_ID],
        },
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    [
      "name only",
      { chatId: CHAT_ID, name: "Renamed" },
      { name: "Renamed" },
    ],
    [
      "avatar only",
      {
        chatId: CHAT_ID,
        avatar: {
          publicId: "new-avatar-id",
          secureUrl: "https://media.example/new-avatar.png",
        },
      },
      {
        avatarCloudinaryPublicId: "new-avatar-id",
        avatar: "https://media.example/new-avatar.png",
      },
    ],
    [
      "name and avatar",
      {
        chatId: CHAT_ID,
        name: "Renamed",
        avatar: {
          publicId: "new-avatar-id",
          secureUrl: "https://media.example/new-avatar.png",
        },
      },
      {
        avatarCloudinaryPublicId: "new-avatar-id",
        avatar: "https://media.example/new-avatar.png",
        name: "Renamed",
      },
    ],
  ] as const)("updates %s with only the current conditional fields and no transaction", async (
    _label,
    input,
    data,
  ) => {
    const updatedChat = {
      id: CHAT_ID,
      name: "Renamed",
      avatar: "https://media.example/new-avatar.png",
    };
    mocks.chatUpdate.mockResolvedValueOnce(updatedChat);

    await expect(repository.updateGroupChat(input)).resolves.toBe(updatedChat);
    expect(mocks.chatUpdate).toHaveBeenCalledWith({
      where: {
        id: CHAT_ID,
      },
      data,
      select: {
        name: true,
        avatar: true,
        id: true,
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns nullable chat reads unchanged", async () => {
    mocks.chatFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await expect(repository.findCreatedGroupChat(CHAT_ID, ACTOR_ID)).resolves.toBeNull();
    await expect(repository.findChatForAddedMemberPayload(CHAT_ID)).resolves.toBeNull();
  });
});
