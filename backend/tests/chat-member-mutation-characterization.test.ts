import type { NextFunction, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertChatAdmin: vi.fn(),
  getCachedAuthorizedChat: vi.fn(),
  transaction: vi.fn(),
  chatFindUnique: vi.fn(),
  chatUpdate: vi.fn(),
  chatMembersFindMany: vi.fn(),
  chatMembersCreateMany: vi.fn(),
  chatMembersDeleteMany: vi.fn(),
  userFindMany: vi.fn(),
  joinMembers: vi.fn(),
  disconnectMembers: vi.fn(),
  emitEvent: vi.fn(),
  emitEventToRoom: vi.fn(),
  resolveIo: vi.fn(),
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

vi.mock("../src/services/authorization.service.js", () => ({
  assertChatAdmin: mocks.assertChatAdmin,
  getCachedAuthorizedChat: mocks.getCachedAuthorizedChat,
}));

vi.mock("../src/modules/read-queries/read-query.service.js", () => ({
  getUserChatsQuery: vi.fn(),
}));

vi.mock("../src/utils/auth.util.js", () => ({
  deleteFilesFromCloudinary: vi.fn(),
  uploadFilesToCloudinary: vi.fn(),
}));

vi.mock("../src/utils/chat.util.js", () => ({
  disconnectMembersFromChatRoom: mocks.disconnectMembers,
  joinMembersInChatRoom: mocks.joinMembers,
}));

vi.mock("../src/utils/socket.util.js", () => ({
  emitEvent: mocks.emitEvent,
  emitEventToRoom: mocks.emitEventToRoom,
}));

vi.mock("../src/utils/upload-lifecycle.util.js", () => ({
  cleanupTemporaryFiles: vi.fn(async () => undefined),
}));

import {
  addMemberToChat,
  removeMemberFromChat,
} from "../src/controllers/chat.controller.js";
import { Events } from "../src/enums/event/event.enum.js";
import type { AuthenticatedRequest } from "../src/interfaces/auth/auth.interface.js";

const ACTOR_ID = "admin-user";
const CHAT_ID = "group-chat";
const io = { marker: "socket-server" };
const createdAt = new Date("2026-08-28T10:00:00.000Z");

const authorizedChat = {
  id: CHAT_ID,
  isGroupChat: true,
  adminId: ACTOR_ID,
  avatarCloudinaryPublicId: "private-avatar-id",
  ChatMembers: [
    { userId: ACTOR_ID },
    { userId: "old-member" },
  ],
};

const oldMemberRows = [
  { id: "membership-admin", chatId: CHAT_ID, userId: ACTOR_ID, user: { id: ACTOR_ID } },
  { id: "membership-old", chatId: CHAT_ID, userId: "old-member", user: { id: "old-member" } },
];

const removalRows = [
  { id: "membership-admin", chatId: CHAT_ID, userId: ACTOR_ID },
  { id: "membership-one", chatId: CHAT_ID, userId: "member-1" },
  { id: "membership-two", chatId: CHAT_ID, userId: "member-2" },
  { id: "membership-three", chatId: CHAT_ID, userId: "member-3" },
];

const newMemberDetails = [{
  id: "new-member",
  username: "new-user",
  avatar: "new-avatar",
  isOnline: false,
  publicKey: null,
  lastSeen: null,
  verificationBadge: false,
}];

const updatedChat = {
  id: CHAT_ID,
  name: "Group",
  isGroupChat: true,
  avatar: "group-avatar",
  adminId: ACTOR_ID,
  latestMessageId: null,
  createdAt,
  updatedAt: createdAt,
  ChatMembers: [],
  latestMessage: null,
};

const expectedAddedMemberChatQuery = {
  where: {
    id: CHAT_ID,
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

const request = (members: string[]) => ({
  user: {
    id: ACTOR_ID,
    username: "admin",
  },
  params: {
    id: CHAT_ID,
  },
  body: {
    members,
  },
  app: {
    get: mocks.resolveIo,
  },
} as unknown as AuthenticatedRequest);

const responseRecorder = () => {
  const status = vi.fn();
  const json = vi.fn();
  const send = vi.fn();
  const end = vi.fn();
  const response = { status, json, send, end } as unknown as Response;
  status.mockReturnValue(response);
  json.mockReturnValue(response);
  send.mockReturnValue(response);
  end.mockReturnValue(response);
  return { response, status, json, send, end };
};

type OrderedMock = {
  mock: {
    invocationCallOrder: number[];
  };
};

const expectCalledBefore = (first: OrderedMock, second: OrderedMock) => {
  expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0]);
};

const expectNoResponse = (recorder: ReturnType<typeof responseRecorder>) => {
  expect(recorder.status).not.toHaveBeenCalled();
  expect(recorder.json).not.toHaveBeenCalled();
  expect(recorder.send).not.toHaveBeenCalled();
  expect(recorder.end).not.toHaveBeenCalled();
};

const expectForwarded = (
  next: ReturnType<typeof vi.fn>,
  error: unknown,
) => {
  expect(next).toHaveBeenCalledOnce();
  expect(next).toHaveBeenCalledWith(error);
};

const invokeAdd = async (members: string[] = ["new-member"]) => {
  const recorder = responseRecorder();
  const next = vi.fn();
  await addMemberToChat(request(members), recorder.response, next as NextFunction);
  return { recorder, next };
};

const invokeRemove = async (members: string[] = ["member-3"]) => {
  const recorder = responseRecorder();
  const next = vi.fn();
  await removeMemberFromChat(request(members), recorder.response, next as NextFunction);
  return { recorder, next };
};

beforeEach(() => {
  vi.resetAllMocks();

  mocks.assertChatAdmin.mockResolvedValue(authorizedChat);
  mocks.resolveIo.mockReturnValue(io);
  mocks.chatMembersFindMany.mockImplementation(async (query: {
    include?: { user?: { select?: { username?: boolean; id?: boolean } } };
  }) => {
    if (query.include?.user?.select?.username) return [];
    if (query.include?.user?.select?.id) return oldMemberRows;
    return removalRows;
  });
  mocks.chatMembersCreateMany.mockResolvedValue({ count: 1 });
  mocks.chatMembersDeleteMany.mockResolvedValue({ count: 1 });
  mocks.userFindMany.mockResolvedValue(newMemberDetails);
  mocks.chatFindUnique.mockResolvedValue(updatedChat);
  mocks.chatUpdate.mockResolvedValue({ id: CHAT_ID });
});

describe("addMemberToChat pre-extraction characterization", () => {
  it("uses exact non-transactional queries, preserves requested duplicates, and performs realtime effects in order", async () => {
    const members = ["new-member", "new-member"];
    const { recorder, next } = await invokeAdd(members);

    expect(mocks.assertChatAdmin).toHaveBeenCalledWith(ACTOR_ID, CHAT_ID);
    expect(mocks.chatMembersFindMany).toHaveBeenNthCalledWith(1, {
      where: {
        chatId: CHAT_ID,
        userId: {
          in: members,
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
      data: [
        { chatId: CHAT_ID, userId: "new-member" },
        { chatId: CHAT_ID, userId: "new-member" },
      ],
    });
    expect(mocks.userFindMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: members,
        },
      },
      select: {
        id: true,
        username: true,
        avatar: true,
        isOnline: true,
        publicKey: true,
        lastSeen: true,
        verificationBadge: true,
      },
    });
    expect(mocks.chatFindUnique).toHaveBeenCalledWith(expectedAddedMemberChatQuery);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.resolveIo).toHaveBeenCalledOnce();
    expect(mocks.resolveIo).toHaveBeenCalledWith("io");
    expect(mocks.joinMembers).toHaveBeenCalledWith({
      io,
      roomToJoin: CHAT_ID,
      memberIds: members,
    });
    expect(mocks.emitEvent).toHaveBeenNthCalledWith(1, {
      event: Events.NEW_CHAT,
      data: {
        ...updatedChat,
        typingUsers: [],
        UnreadMessages: [],
      },
      io,
      users: members,
    });
    const responsePayload = {
      chatId: CHAT_ID,
      members: newMemberDetails,
    };
    expect(mocks.emitEvent).toHaveBeenNthCalledWith(2, {
      data: responsePayload,
      event: Events.NEW_MEMBER_ADDED,
      io,
      users: [ACTOR_ID, "old-member"],
    });
    expectCalledBefore(mocks.assertChatAdmin, mocks.chatMembersFindMany);
    expect(mocks.chatMembersFindMany.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.chatMembersFindMany.mock.invocationCallOrder[1]);
    expect(mocks.chatMembersFindMany.mock.invocationCallOrder[1])
      .toBeLessThan(mocks.chatMembersCreateMany.mock.invocationCallOrder[0]);
    expectCalledBefore(mocks.chatMembersCreateMany, mocks.userFindMany);
    expectCalledBefore(mocks.userFindMany, mocks.chatFindUnique);
    expectCalledBefore(mocks.chatFindUnique, mocks.resolveIo);
    expectCalledBefore(mocks.resolveIo, mocks.joinMembers);
    expectCalledBefore(mocks.joinMembers, mocks.emitEvent);
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith(responsePayload);
    expect(next).not.toHaveBeenCalled();
  });

  it("preserves comma-without-space duplicate-member interpolation and stops before the old-member snapshot", async () => {
    mocks.chatMembersFindMany.mockResolvedValueOnce([
      { user: { username: "alice" } },
      { user: { username: "bob" } },
    ]);

    const { recorder, next } = await invokeAdd(["existing-a", "existing-b"]);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400,
      message: "alice,bob already exists in members of this chat",
    }));
    expect(mocks.chatMembersFindMany).toHaveBeenCalledOnce();
    expect(mocks.chatMembersCreateMany).not.toHaveBeenCalled();
    expect(mocks.userFindMany).not.toHaveBeenCalled();
    expect(mocks.chatFindUnique).not.toHaveBeenCalled();
    expect(mocks.resolveIo).not.toHaveBeenCalled();
    expectNoResponse(recorder);
  });

  it("keeps the schema-compatible empty member array and still runs the existing empty workflow", async () => {
    mocks.userFindMany.mockResolvedValue([]);

    const { recorder, next } = await invokeAdd([]);

    expect(mocks.chatMembersCreateMany).toHaveBeenCalledWith({ data: [] });
    expect(mocks.userFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: [] } },
    }));
    expect(mocks.joinMembers).toHaveBeenCalledWith({
      io,
      roomToJoin: CHAT_ID,
      memberIds: [],
    });
    expect(mocks.emitEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      event: Events.NEW_CHAT,
      users: [],
    }));
    expect(mocks.emitEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      event: Events.NEW_MEMBER_ADDED,
      users: [ACTOR_ID, "old-member"],
      data: { chatId: CHAT_ID, members: [] },
    }));
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith({ chatId: CHAT_ID, members: [] });
    expect(next).not.toHaveBeenCalled();
  });

  it("keeps emitting a skeletal NEW_CHAT payload when the updated-chat lookup returns null", async () => {
    mocks.chatFindUnique.mockResolvedValue(null);

    const { recorder, next } = await invokeAdd();

    expect(mocks.emitEvent).toHaveBeenNthCalledWith(1, {
      event: Events.NEW_CHAT,
      data: {
        typingUsers: [],
        UnreadMessages: [],
      },
      io,
      users: ["new-member"],
    });
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it("forwards authorization failure before any mutation query", async () => {
    const error = new Error("authorization failure");
    mocks.assertChatAdmin.mockRejectedValue(error);

    const { recorder, next } = await invokeAdd();

    expectForwarded(next, error);
    expect(mocks.chatMembersFindMany).not.toHaveBeenCalled();
    expect(mocks.chatMembersCreateMany).not.toHaveBeenCalled();
    expect(mocks.resolveIo).not.toHaveBeenCalled();
    expectNoResponse(recorder);
  });

  it("stops after a duplicate-lookup failure", async () => {
    const error = new Error("duplicate lookup failure");
    mocks.chatMembersFindMany.mockRejectedValueOnce(error);

    const { recorder, next } = await invokeAdd();

    expectForwarded(next, error);
    expect(mocks.chatMembersFindMany).toHaveBeenCalledOnce();
    expect(mocks.chatMembersCreateMany).not.toHaveBeenCalled();
    expect(mocks.resolveIo).not.toHaveBeenCalled();
    expectNoResponse(recorder);
  });

  it("stops before insertion when the old-member snapshot fails", async () => {
    const error = new Error("old member lookup failure");
    mocks.chatMembersFindMany
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(error);

    const { recorder, next } = await invokeAdd();

    expectForwarded(next, error);
    expect(mocks.chatMembersCreateMany).not.toHaveBeenCalled();
    expect(mocks.userFindMany).not.toHaveBeenCalled();
    expect(mocks.resolveIo).not.toHaveBeenCalled();
    expectNoResponse(recorder);
  });

  it("stops all post-insert work when createMany fails", async () => {
    const error = new Error("createMany failure");
    mocks.chatMembersCreateMany.mockRejectedValue(error);

    const { recorder, next } = await invokeAdd();

    expectForwarded(next, error);
    expect(mocks.userFindMany).not.toHaveBeenCalled();
    expect(mocks.chatFindUnique).not.toHaveBeenCalled();
    expect(mocks.resolveIo).not.toHaveBeenCalled();
    expectNoResponse(recorder);
  });

  it("leaves inserted memberships and stops when new-member detail lookup fails", async () => {
    const error = new Error("member detail failure");
    mocks.userFindMany.mockRejectedValue(error);

    const { recorder, next } = await invokeAdd();

    expectForwarded(next, error);
    expect(mocks.chatMembersCreateMany).toHaveBeenCalledOnce();
    expect(mocks.chatFindUnique).not.toHaveBeenCalled();
    expect(mocks.resolveIo).not.toHaveBeenCalled();
    expectNoResponse(recorder);
  });

  it("leaves inserted memberships and stops before Socket lookup when updated-chat lookup fails", async () => {
    const error = new Error("updated chat failure");
    mocks.chatFindUnique.mockRejectedValue(error);

    const { recorder, next } = await invokeAdd();

    expectForwarded(next, error);
    expect(mocks.chatMembersCreateMany).toHaveBeenCalledOnce();
    expect(mocks.userFindMany).toHaveBeenCalledOnce();
    expect(mocks.resolveIo).not.toHaveBeenCalled();
    expect(mocks.joinMembers).not.toHaveBeenCalled();
    expectNoResponse(recorder);
  });

  it("leaves database work complete and emits nothing when Socket lookup fails", async () => {
    const error = new Error("socket lookup failure");
    mocks.resolveIo.mockImplementation(() => {
      throw error;
    });

    const { recorder, next } = await invokeAdd();

    expectForwarded(next, error);
    expect(mocks.chatMembersCreateMany).toHaveBeenCalledOnce();
    expect(mocks.chatFindUnique).toHaveBeenCalledOnce();
    expect(mocks.joinMembers).not.toHaveBeenCalled();
    expect(mocks.emitEvent).not.toHaveBeenCalled();
    expectNoResponse(recorder);
  });

  it("stops before events when joining new members fails", async () => {
    const error = new Error("join failure");
    mocks.joinMembers.mockImplementation(() => {
      throw error;
    });

    const { recorder, next } = await invokeAdd();

    expectForwarded(next, error);
    expect(mocks.chatMembersCreateMany).toHaveBeenCalledOnce();
    expect(mocks.emitEvent).not.toHaveBeenCalled();
    expectNoResponse(recorder);
  });

  it("stops before NEW_MEMBER_ADDED and the response when NEW_CHAT emission fails", async () => {
    const error = new Error("new chat emit failure");
    mocks.emitEvent.mockImplementationOnce(() => {
      throw error;
    });

    const { recorder, next } = await invokeAdd();

    expectForwarded(next, error);
    expect(mocks.joinMembers).toHaveBeenCalledOnce();
    expect(mocks.emitEvent).toHaveBeenCalledOnce();
    expectNoResponse(recorder);
  });

  it("keeps NEW_CHAT delivered but sends no response when NEW_MEMBER_ADDED emission fails", async () => {
    const error = new Error("member added emit failure");
    mocks.emitEvent
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw error;
      });

    const { recorder, next } = await invokeAdd();

    expectForwarded(next, error);
    expect(mocks.emitEvent).toHaveBeenCalledTimes(2);
    expectNoResponse(recorder);
  });
});

describe("removeMemberFromChat pre-extraction characterization", () => {
  it("uses the exact non-transactional delete and preserves duplicate removal IDs across realtime and response", async () => {
    const members = ["member-3", "member-3"];
    const { recorder, next } = await invokeRemove(members);

    expect(mocks.assertChatAdmin).toHaveBeenCalledWith(ACTOR_ID, CHAT_ID);
    expect(mocks.chatMembersFindMany).toHaveBeenCalledWith({
      where: {
        chatId: CHAT_ID,
      },
    });
    expect(mocks.chatUpdate).not.toHaveBeenCalled();
    expect(mocks.chatMembersDeleteMany).toHaveBeenCalledWith({
      where: {
        chatId: CHAT_ID,
        userId: {
          in: members,
        },
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.resolveIo).toHaveBeenCalledOnce();
    expect(mocks.resolveIo).toHaveBeenCalledWith("io");
    expect(mocks.disconnectMembers).toHaveBeenCalledWith({
      io,
      memberIds: members,
      roomToLeave: CHAT_ID,
    });
    expect(mocks.emitEvent).toHaveBeenNthCalledWith(1, {
      io,
      event: Events.DELETE_CHAT,
      users: members,
      data: {
        chatId: CHAT_ID,
      },
    });
    const responsePayload = {
      chatId: CHAT_ID,
      membersId: members,
    };
    expect(mocks.emitEvent).toHaveBeenNthCalledWith(2, {
      io,
      event: Events.MEMBER_REMOVED,
      data: responsePayload,
      users: [ACTOR_ID, "member-1", "member-2"],
    });
    expectCalledBefore(mocks.assertChatAdmin, mocks.chatMembersFindMany);
    expectCalledBefore(mocks.chatMembersFindMany, mocks.chatMembersDeleteMany);
    expectCalledBefore(mocks.chatMembersDeleteMany, mocks.resolveIo);
    expectCalledBefore(mocks.resolveIo, mocks.disconnectMembers);
    expectCalledBefore(mocks.disconnectMembers, mocks.emitEvent);
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith(responsePayload);
    expect(next).not.toHaveBeenCalled();
  });

  it("checks the exact length===3 rule before missing-member detection", async () => {
    mocks.chatMembersFindMany.mockResolvedValue([
      { userId: ACTOR_ID },
      { userId: "member-1" },
      { userId: "member-2" },
    ]);

    const { recorder, next } = await invokeRemove(["not-a-member"]);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400,
      message: "Minimum 3 members are required in a group chat",
    }));
    expect(mocks.chatUpdate).not.toHaveBeenCalled();
    expect(mocks.chatMembersDeleteMany).not.toHaveBeenCalled();
    expect(mocks.resolveIo).not.toHaveBeenCalled();
    expectNoResponse(recorder);
  });

  it("does not broaden the minimum rule to <=3", async () => {
    mocks.chatMembersFindMany.mockResolvedValue([
      { userId: ACTOR_ID },
      { userId: "member-1" },
    ]);

    const { recorder, next } = await invokeRemove(["member-1"]);

    expect(mocks.chatMembersDeleteMany).toHaveBeenCalledOnce();
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(recorder.json).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      membersId: ["member-1"],
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("does not replace the current rule with remaining-member validation and may remove every member from a four-row chat", async () => {
    const allMembers = [ACTOR_ID, "member-1", "member-2", "member-3"];

    const { recorder, next } = await invokeRemove(allMembers);

    expect(mocks.chatUpdate).not.toHaveBeenCalled();
    expect(mocks.chatMembersDeleteMany).toHaveBeenCalledWith({
      where: {
        chatId: CHAT_ID,
        userId: {
          in: allMembers,
        },
      },
    });
    expect(mocks.emitEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      event: Events.MEMBER_REMOVED,
      users: [],
    }));
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns the exact misspelled missing-member error and performs no write or realtime work", async () => {
    const { recorder, next } = await invokeRemove(["not-a-member"]);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 404,
      message: "Provided members to be removed dosen't exists in chat",
    }));
    expect(mocks.chatUpdate).not.toHaveBeenCalled();
    expect(mocks.chatMembersDeleteMany).not.toHaveBeenCalled();
    expect(mocks.resolveIo).not.toHaveBeenCalled();
    expectNoResponse(recorder);
  });

  it("reassigns to the first eligible member in database order while skipping other requested removals", async () => {
    mocks.chatMembersFindMany.mockResolvedValue([
      { userId: "remove-too" },
      { userId: ACTOR_ID },
      { userId: "candidate-first" },
      { userId: "candidate-second" },
    ]);

    const { recorder, next } = await invokeRemove([ACTOR_ID, "remove-too"]);

    expect(mocks.chatUpdate).toHaveBeenCalledWith({
      where: {
        id: CHAT_ID,
      },
      data: {
        adminId: "candidate-first",
      },
    });
    expectCalledBefore(mocks.chatUpdate, mocks.chatMembersDeleteMany);
    expect(mocks.emitEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      event: Events.MEMBER_REMOVED,
      users: ["candidate-first", "candidate-second"],
    }));
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it("keeps the schema-compatible empty removal workflow when the row count is not three", async () => {
    const { recorder, next } = await invokeRemove([]);

    expect(mocks.chatMembersDeleteMany).toHaveBeenCalledWith({
      where: {
        chatId: CHAT_ID,
        userId: {
          in: [],
        },
      },
    });
    expect(mocks.disconnectMembers).toHaveBeenCalledWith({
      io,
      memberIds: [],
      roomToLeave: CHAT_ID,
    });
    expect(mocks.emitEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      event: Events.DELETE_CHAT,
      users: [],
    }));
    expect(mocks.emitEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      event: Events.MEMBER_REMOVED,
      users: [ACTOR_ID, "member-1", "member-2", "member-3"],
      data: { chatId: CHAT_ID, membersId: [] },
    }));
    expect(recorder.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it("forwards authorization failure before the membership snapshot", async () => {
    const error = new Error("authorization failure");
    mocks.assertChatAdmin.mockRejectedValue(error);

    const { recorder, next } = await invokeRemove();

    expectForwarded(next, error);
    expect(mocks.chatMembersFindMany).not.toHaveBeenCalled();
    expect(mocks.chatMembersDeleteMany).not.toHaveBeenCalled();
    expect(mocks.resolveIo).not.toHaveBeenCalled();
    expectNoResponse(recorder);
  });

  it("stops before writes when the membership snapshot fails", async () => {
    const error = new Error("member snapshot failure");
    mocks.chatMembersFindMany.mockRejectedValue(error);

    const { recorder, next } = await invokeRemove();

    expectForwarded(next, error);
    expect(mocks.chatUpdate).not.toHaveBeenCalled();
    expect(mocks.chatMembersDeleteMany).not.toHaveBeenCalled();
    expect(mocks.resolveIo).not.toHaveBeenCalled();
    expectNoResponse(recorder);
  });

  it("stops before deletion when admin reassignment fails", async () => {
    const error = new Error("admin update failure");
    mocks.chatUpdate.mockRejectedValue(error);

    const { recorder, next } = await invokeRemove([ACTOR_ID]);

    expectForwarded(next, error);
    expect(mocks.chatUpdate).toHaveBeenCalledOnce();
    expect(mocks.chatMembersDeleteMany).not.toHaveBeenCalled();
    expect(mocks.resolveIo).not.toHaveBeenCalled();
    expectNoResponse(recorder);
  });

  it("leaves admin reassignment complete when membership deletion fails", async () => {
    const error = new Error("delete members failure");
    mocks.chatMembersDeleteMany.mockRejectedValue(error);

    const { recorder, next } = await invokeRemove([ACTOR_ID]);

    expectForwarded(next, error);
    expect(mocks.chatUpdate).toHaveBeenCalledOnce();
    expectCalledBefore(mocks.chatUpdate, mocks.chatMembersDeleteMany);
    expect(mocks.resolveIo).not.toHaveBeenCalled();
    expectNoResponse(recorder);
  });

  it("keeps deletion complete and emits nothing when Socket lookup fails", async () => {
    const error = new Error("socket lookup failure");
    mocks.resolveIo.mockImplementation(() => {
      throw error;
    });

    const { recorder, next } = await invokeRemove();

    expectForwarded(next, error);
    expect(mocks.chatMembersDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.disconnectMembers).not.toHaveBeenCalled();
    expect(mocks.emitEvent).not.toHaveBeenCalled();
    expectNoResponse(recorder);
  });

  it("stops before events when room disconnection fails", async () => {
    const error = new Error("disconnect failure");
    mocks.disconnectMembers.mockImplementation(() => {
      throw error;
    });

    const { recorder, next } = await invokeRemove();

    expectForwarded(next, error);
    expect(mocks.chatMembersDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.emitEvent).not.toHaveBeenCalled();
    expectNoResponse(recorder);
  });

  it("stops before MEMBER_REMOVED and the response when DELETE_CHAT emission fails", async () => {
    const error = new Error("delete chat emit failure");
    mocks.emitEvent.mockImplementationOnce(() => {
      throw error;
    });

    const { recorder, next } = await invokeRemove();

    expectForwarded(next, error);
    expect(mocks.disconnectMembers).toHaveBeenCalledOnce();
    expect(mocks.emitEvent).toHaveBeenCalledOnce();
    expectNoResponse(recorder);
  });

  it("keeps DELETE_CHAT delivered but sends no response when MEMBER_REMOVED emission fails", async () => {
    const error = new Error("member removed emit failure");
    mocks.emitEvent
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw error;
      });

    const { recorder, next } = await invokeRemove();

    expectForwarded(next, error);
    expect(mocks.emitEvent).toHaveBeenCalledTimes(2);
    expectNoResponse(recorder);
  });
});
