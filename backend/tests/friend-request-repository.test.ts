import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  friendRequestFindMany: vi.fn(),
  friendRequestFindFirst: vi.fn(),
  friendRequestCreate: vi.fn(),
  friendRequestDelete: vi.fn(),
  friendsFindFirst: vi.fn(),
  friendsCreate: vi.fn(),
  chatFindFirst: vi.fn(),
  chatCreate: vi.fn(),
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
    },
    friendRequest: {
      findMany: mocks.friendRequestFindMany,
      findFirst: mocks.friendRequestFindFirst,
      create: mocks.friendRequestCreate,
      delete: mocks.friendRequestDelete,
    },
    friends: {
      findFirst: mocks.friendsFindFirst,
      create: mocks.friendsCreate,
    },
    chat: {
      findFirst: mocks.chatFindFirst,
      create: mocks.chatCreate,
    },
  },
}));

import { prisma } from "../src/lib/prisma.lib.js";
import type { PrivateChatView } from "../src/modules/friend-requests/contracts/friend-request.types.js";
import {
  createPrismaFriendRequestRepository,
  FRIEND_REQUEST_PARTICIPANT_SELECT,
  prismaFriendRequestRepository,
  REJECTED_REQUEST_SENDER_SELECT,
} from "../src/modules/friend-requests/infrastructure/prisma-friend-request.repository.js";

const repository = createPrismaFriendRequestRepository(prisma);
const SENDER_ID = "sender-user";
const RECEIVER_ID = "receiver-user";
const REQUEST_ID = "request-1";
const CHAT_ID = "chat-1";
const CREATED_AT = new Date("2026-08-27T10:00:00.000Z");
const UPDATED_AT = new Date("2026-08-27T10:05:00.000Z");

const PARTICIPANT_SELECT = {
  id: true,
  username: true,
  avatar: true,
  isOnline: true,
  publicKey: true,
  lastSeen: true,
  verificationBadge: true,
};

const participant = {
  id: SENDER_ID,
  username: "sender",
  avatar: "https://media.example/sender.png",
  isOnline: true,
  publicKey: "sender-public-key",
  lastSeen: CREATED_AT,
  verificationBadge: true,
};

const privateChat = {
  id: CHAT_ID,
  name: null,
  isGroupChat: false,
  avatar: "https://media.example/default-chat.png",
  adminId: null,
  latestMessageId: null,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  ChatMembers: [
    { user: participant },
    {
      user: {
        ...participant,
        id: RECEIVER_ID,
        username: "receiver",
      },
    },
  ],
  UnreadMessages: [],
  latestMessage: null,
} satisfies PrivateChatView;

const expectedPrivateChatCreateArgs = {
  data: {
    ChatMembers: {
      create: [
        { user: { connect: { id: SENDER_ID } } },
        { user: { connect: { id: RECEIVER_ID } } },
      ],
    },
  },
  omit: {
    avatarCloudinaryPublicId: true,
  },
  include: {
    ChatMembers: {
      include: {
        user: {
          select: PARTICIPANT_SELECT,
        },
      },
      omit: {
        chatId: true,
        userId: true,
        id: true,
      },
    },
    UnreadMessages: {
      where: {
        userId: RECEIVER_ID,
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
          select: PARTICIPANT_SELECT,
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
};

describe("Prisma friend-request repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports the exact shared projections and a composed singleton", () => {
    expect(FRIEND_REQUEST_PARTICIPANT_SELECT).toEqual(PARTICIPANT_SELECT);
    expect(REJECTED_REQUEST_SENDER_SELECT).toEqual({
      isOnline: true,
      fcmToken: true,
      notificationsEnabled: true,
    });
    expect(prismaFriendRequestRepository).toBeDefined();
  });

  it("lists incoming requests with the exact receiver filter and public projection", async () => {
    const requests = [{
      id: REQUEST_ID,
      senderId: SENDER_ID,
      status: "pending",
      createdAt: CREATED_AT,
      sender: participant,
    }];
    mocks.friendRequestFindMany.mockResolvedValueOnce(requests);

    await expect(repository.listIncomingRequests(RECEIVER_ID)).resolves.toBe(requests);
    expect(mocks.friendRequestFindMany).toHaveBeenCalledWith({
      where: {
        receiverId: RECEIVER_ID,
      },
      include: {
        sender: {
          select: PARTICIPANT_SELECT,
        },
      },
      omit: {
        receiverId: true,
        updatedAt: true,
      },
    });
  });

  it("finds a receiver with the unchanged full query but returns only notification state", async () => {
    mocks.userFindUnique.mockResolvedValueOnce({
      id: RECEIVER_ID,
      fcmToken: "receiver-token",
      notificationsEnabled: true,
      email: "private@example.test",
      hashedPassword: "private-password-hash",
      privateKey: "private-key",
    });

    await expect(repository.findRequestReceiver(RECEIVER_ID)).resolves.toEqual({
      id: RECEIVER_ID,
      fcmToken: "receiver-token",
      notificationsEnabled: true,
    });
    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { id: RECEIVER_ID },
    });
    const result = await repository.findRequestReceiver("missing-receiver");
    expect(result).toBeNull();
    expect(mocks.userFindUnique).toHaveBeenNthCalledWith(2, {
      where: { id: "missing-receiver" },
    });
  });

  it("checks an outgoing request with the exact ordered AND predicate", async () => {
    mocks.friendRequestFindFirst.mockResolvedValueOnce({ id: REQUEST_ID });

    await expect(repository.outgoingRequestExists(SENDER_ID, RECEIVER_ID)).resolves.toBe(true);
    expect(mocks.friendRequestFindFirst).toHaveBeenCalledWith({
      where: {
        AND: [
          { receiverId: RECEIVER_ID },
          { senderId: SENDER_ID },
        ],
      },
    });
  });

  it("checks a reverse request with the exact ordered AND predicate", async () => {
    mocks.friendRequestFindFirst.mockResolvedValueOnce({ id: REQUEST_ID });

    await expect(repository.reverseRequestExists(SENDER_ID, RECEIVER_ID)).resolves.toBe(true);
    expect(mocks.friendRequestFindFirst).toHaveBeenCalledWith({
      where: {
        AND: [
          { senderId: RECEIVER_ID },
          { receiverId: SENDER_ID },
        ],
      },
    });
  });

  it("checks friendship in both orientations with the exact OR predicate", async () => {
    mocks.friendsFindFirst.mockResolvedValueOnce({ id: "friendship-1" });

    await expect(repository.friendshipExists(SENDER_ID, RECEIVER_ID)).resolves.toBe(true);
    expect(mocks.friendsFindFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { user1Id: SENDER_ID, user2Id: RECEIVER_ID },
          { user1Id: RECEIVER_ID, user2Id: SENDER_ID },
        ],
      },
    });
  });

  it("creates a request with the exact data, sender projection, and omit shape", async () => {
    const createdRequest = {
      id: REQUEST_ID,
      status: "pending",
      createdAt: CREATED_AT,
      sender: participant,
    };
    mocks.friendRequestCreate.mockResolvedValueOnce(createdRequest);

    await expect(repository.createRequest(SENDER_ID, RECEIVER_ID)).resolves.toBe(createdRequest);
    expect(mocks.friendRequestCreate).toHaveBeenCalledWith({
      data: {
        senderId: SENDER_ID,
        receiverId: RECEIVER_ID,
      },
      include: {
        sender: {
          select: PARTICIPANT_SELECT,
        },
      },
      omit: {
        receiverId: true,
        updatedAt: true,
        senderId: true,
      },
    });
  });

  it("finds a request with the unchanged query and maps only authorization fields", async () => {
    mocks.friendRequestFindFirst.mockResolvedValueOnce({
      id: REQUEST_ID,
      senderId: SENDER_ID,
      receiverId: RECEIVER_ID,
      status: "pending",
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });

    await expect(repository.findRequestById(REQUEST_ID)).resolves.toEqual({
      id: REQUEST_ID,
      senderId: SENDER_ID,
      receiverId: RECEIVER_ID,
    });
    expect(mocks.friendRequestFindFirst).toHaveBeenCalledWith({
      where: {
        id: REQUEST_ID,
      },
    });
  });

  it("preserves the current private-chat every/in existence query", async () => {
    mocks.chatFindFirst.mockResolvedValueOnce({ id: CHAT_ID });

    await expect(repository.privateChatExists(SENDER_ID, RECEIVER_ID)).resolves.toBe(true);
    expect(mocks.chatFindFirst).toHaveBeenCalledWith({
      where: {
        isGroupChat: false,
        ChatMembers: {
          every: {
            userId: { in: [SENDER_ID, RECEIVER_ID] },
          },
        },
      },
    });
  });

  it("creates a private chat with the complete unchanged data and projection", async () => {
    mocks.chatCreate.mockResolvedValueOnce(privateChat);

    await expect(repository.createPrivateChat(
      SENDER_ID,
      RECEIVER_ID,
      RECEIVER_ID,
    )).resolves.toBe(privateChat);
    expect(mocks.chatCreate).toHaveBeenCalledWith(expectedPrivateChatCreateArgs);
  });

  it("creates a friendship with full Prisma includes but maps both users safely", async () => {
    mocks.friendsCreate.mockResolvedValueOnce({
      id: "friendship-1",
      user1Id: SENDER_ID,
      user2Id: RECEIVER_ID,
      createdAt: CREATED_AT,
      user1: {
        id: SENDER_ID,
        fcmToken: "sender-token",
        notificationsEnabled: true,
        email: "sender-private@example.test",
        privateKey: "sender-private-key",
      },
      user2: {
        id: RECEIVER_ID,
        fcmToken: null,
        notificationsEnabled: false,
        hashedPassword: "receiver-private-hash",
      },
    });

    await expect(repository.createFriendship(SENDER_ID, RECEIVER_ID)).resolves.toEqual({
      user1: {
        id: SENDER_ID,
        fcmToken: "sender-token",
        notificationsEnabled: true,
      },
      user2: {
        id: RECEIVER_ID,
        fcmToken: null,
        notificationsEnabled: false,
      },
    });
    expect(mocks.friendsCreate).toHaveBeenCalledWith({
      data: {
        user1: {
          connect: {
            id: SENDER_ID,
          },
        },
        user2: {
          connect: {
            id: RECEIVER_ID,
          },
        },
      },
      include: {
        user1: true,
        user2: true,
      },
    });
  });

  it("deletes an accepted request with only the current where clause", async () => {
    mocks.friendRequestDelete.mockResolvedValueOnce({ id: REQUEST_ID });

    await expect(repository.deleteRequest(REQUEST_ID)).resolves.toBeUndefined();
    expect(mocks.friendRequestDelete).toHaveBeenCalledWith({
      where: {
        id: REQUEST_ID,
      },
    });
  });

  it("deletes a rejected request with the exact sender select and maps unused state out", async () => {
    mocks.friendRequestDelete.mockResolvedValueOnce({
      id: REQUEST_ID,
      sender: {
        isOnline: true,
        fcmToken: "sender-token",
        notificationsEnabled: true,
      },
    });

    await expect(repository.deleteRequestWithSenderState(REQUEST_ID)).resolves.toEqual({
      id: REQUEST_ID,
      sender: {
        fcmToken: "sender-token",
        notificationsEnabled: true,
      },
    });
    expect(mocks.friendRequestDelete).toHaveBeenCalledWith({
      where: {
        id: REQUEST_ID,
      },
      include: {
        sender: {
          select: {
            isOnline: true,
            fcmToken: true,
            notificationsEnabled: true,
          },
        },
      },
    });
  });

  it.each([
    ["incoming request list", mocks.friendRequestFindMany, () => repository.listIncomingRequests(RECEIVER_ID)],
    ["receiver lookup", mocks.userFindUnique, () => repository.findRequestReceiver(RECEIVER_ID)],
    ["outgoing request lookup", mocks.friendRequestFindFirst, () => repository.outgoingRequestExists(SENDER_ID, RECEIVER_ID)],
    ["reverse request lookup", mocks.friendRequestFindFirst, () => repository.reverseRequestExists(SENDER_ID, RECEIVER_ID)],
    ["friendship lookup", mocks.friendsFindFirst, () => repository.friendshipExists(SENDER_ID, RECEIVER_ID)],
    ["request creation", mocks.friendRequestCreate, () => repository.createRequest(SENDER_ID, RECEIVER_ID)],
    ["request lookup", mocks.friendRequestFindFirst, () => repository.findRequestById(REQUEST_ID)],
    ["private-chat lookup", mocks.chatFindFirst, () => repository.privateChatExists(SENDER_ID, RECEIVER_ID)],
    ["private-chat creation", mocks.chatCreate, () => repository.createPrivateChat(SENDER_ID, RECEIVER_ID, RECEIVER_ID)],
    ["friendship creation", mocks.friendsCreate, () => repository.createFriendship(SENDER_ID, RECEIVER_ID)],
    ["accepted-request deletion", mocks.friendRequestDelete, () => repository.deleteRequest(REQUEST_ID)],
    ["rejected-request deletion", mocks.friendRequestDelete, () => repository.deleteRequestWithSenderState(REQUEST_ID)],
  ] as const)("propagates the original Prisma rejection for %s", async (_label, operation, invoke) => {
    const failure = new Error("private Prisma failure detail");
    operation.mockRejectedValueOnce(failure);

    await expect(invoke()).rejects.toBe(failure);
  });
});
