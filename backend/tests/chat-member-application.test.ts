import { describe, expect, it, vi } from "vitest";

import { ApplicationError } from "../src/errors/application-error.js";
import { createChatMemberAdder } from "../src/modules/chats/application/add-chat-members.js";
import { createChatMemberRemover } from "../src/modules/chats/application/remove-chat-members.js";
import type { ChatRealtimePort } from "../src/modules/chats/contracts/chat-realtime.port.js";
import type { ChatRepository } from "../src/modules/chats/contracts/chat.repository.js";
import type {
  AuthorizedChatMutationContext,
  ChatMemberPublicView,
  GroupChatMutationView,
} from "../src/modules/chats/contracts/chat.types.js";

const ROUTE_CHAT_ID = "route-chat";
const AUTHORIZED_CHAT_ID = "authorized-chat";
const ADMIN_ID = "admin-user";
const createdAt = new Date("2026-08-28T12:00:00.000Z");

const authorizedChat: AuthorizedChatMutationContext = {
  id: AUTHORIZED_CHAT_ID,
  adminId: ADMIN_ID,
  avatarCloudinaryPublicId: "private-avatar-id",
};

const newMemberDetails: ChatMemberPublicView[] = [{
  id: "new-member",
  username: "new-user",
  avatar: "new-avatar",
  isOnline: false,
  publicKey: null,
  lastSeen: null,
  verificationBadge: false,
}];

const updatedChat: GroupChatMutationView = {
  id: AUTHORIZED_CHAT_ID,
  name: "Group",
  isGroupChat: true,
  avatar: "group-avatar",
  adminId: ADMIN_ID,
  latestMessageId: null,
  createdAt,
  updatedAt: createdAt,
  ChatMembers: [],
  latestMessage: null,
};

const createAddRepository = () => ({
  findExistingRequestedMemberUsernames:
    vi.fn<ChatRepository["findExistingRequestedMemberUsernames"]>()
      .mockResolvedValue([]),
  listMemberIdsForAddition:
    vi.fn<ChatRepository["listMemberIdsForAddition"]>()
      .mockResolvedValue([ADMIN_ID, "old-member"]),
  addMembers:
    vi.fn<ChatRepository["addMembers"]>()
      .mockResolvedValue(undefined),
  findMemberPublicDetails:
    vi.fn<ChatRepository["findMemberPublicDetails"]>()
      .mockResolvedValue(newMemberDetails),
  findChatForAddedMemberPayload:
    vi.fn<ChatRepository["findChatForAddedMemberPayload"]>()
      .mockResolvedValue(updatedChat),
});

const createRemoveRepository = () => ({
  listMemberIdsForRemoval:
    vi.fn<ChatRepository["listMemberIdsForRemoval"]>()
      .mockResolvedValue([ADMIN_ID, "member-1", "member-2", "member-3"]),
  updateAdmin:
    vi.fn<ChatRepository["updateAdmin"]>()
      .mockResolvedValue(undefined),
  deleteMembers:
    vi.fn<ChatRepository["deleteMembers"]>()
      .mockResolvedValue(undefined),
});

const createRealtime = (): ChatRealtimePort => ({
  joinMembers: vi.fn<ChatRealtimePort["joinMembers"]>(),
  emitNewChatToRoom: vi.fn<ChatRealtimePort["emitNewChatToRoom"]>(),
  emitNewChatToMembers: vi.fn<ChatRealtimePort["emitNewChatToMembers"]>(),
  emitMembersAdded: vi.fn<ChatRealtimePort["emitMembersAdded"]>(),
  disconnectMembers: vi.fn<ChatRealtimePort["disconnectMembers"]>(),
  emitDeleteChat: vi.fn<ChatRealtimePort["emitDeleteChat"]>(),
  emitMembersRemoved: vi.fn<ChatRealtimePort["emitMembersRemoved"]>(),
  emitGroupChatUpdate: vi.fn<ChatRealtimePort["emitGroupChatUpdate"]>(),
});

type OrderedMock = {
  mock: {
    invocationCallOrder: number[];
  };
};

const expectCalledBefore = (first: OrderedMock, second: OrderedMock) => {
  expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0]);
};

const expectApplicationError = async (
  result: Promise<unknown>,
  statusCode: number,
  message: string,
) => {
  const error = await result.catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(ApplicationError);
  expect(error).toMatchObject({ statusCode, message });
};

const addInput = (memberIds: string[] = ["new-member"]) => ({
  chatId: ROUTE_CHAT_ID,
  authorizedChat,
  memberIds,
});

const removeInput = (memberIds: string[] = ["member-3"]) => ({
  chatId: ROUTE_CHAT_ID,
  authorizedChat,
  memberIds,
});

describe("add-chat-members application", () => {
  it("preserves route versus authorized chat IDs, requested duplicates, payloads, targets, and effect order", async () => {
    const repository = createAddRepository();
    const realtime = createRealtime();
    const addMembers = createChatMemberAdder({ repository, realtime });
    const memberIds = ["new-member", "new-member"];

    const result = await addMembers(addInput(memberIds));

    expect(repository.findExistingRequestedMemberUsernames)
      .toHaveBeenCalledWith(ROUTE_CHAT_ID, memberIds);
    expect(repository.listMemberIdsForAddition).toHaveBeenCalledWith(ROUTE_CHAT_ID);
    expect(repository.addMembers).toHaveBeenCalledWith(ROUTE_CHAT_ID, memberIds);
    expect(repository.findMemberPublicDetails).toHaveBeenCalledWith(memberIds);
    expect(repository.findChatForAddedMemberPayload).toHaveBeenCalledWith(AUTHORIZED_CHAT_ID);

    expect(realtime.joinMembers).toHaveBeenCalledWith(memberIds, AUTHORIZED_CHAT_ID);
    expect(realtime.emitNewChatToMembers).toHaveBeenCalledWith(memberIds, {
      ...updatedChat,
      typingUsers: [],
      UnreadMessages: [],
    });
    const payload = {
      chatId: AUTHORIZED_CHAT_ID,
      members: newMemberDetails,
    };
    expect(realtime.emitMembersAdded).toHaveBeenCalledWith(
      [ADMIN_ID, "old-member"],
      payload,
    );
    expect(result).toEqual(payload);

    expectCalledBefore(
      repository.findExistingRequestedMemberUsernames,
      repository.listMemberIdsForAddition,
    );
    expectCalledBefore(repository.listMemberIdsForAddition, repository.addMembers);
    expectCalledBefore(repository.addMembers, repository.findMemberPublicDetails);
    expectCalledBefore(
      repository.findMemberPublicDetails,
      repository.findChatForAddedMemberPayload,
    );
    expectCalledBefore(repository.findChatForAddedMemberPayload, realtime.joinMembers);
    expectCalledBefore(realtime.joinMembers, realtime.emitNewChatToMembers);
    expectCalledBefore(realtime.emitNewChatToMembers, realtime.emitMembersAdded);
  });

  it("uses exact comma-without-space duplicate interpolation and stops immediately", async () => {
    const repository = createAddRepository();
    const realtime = createRealtime();
    repository.findExistingRequestedMemberUsernames.mockResolvedValue(["alice", "bob"]);
    const addMembers = createChatMemberAdder({ repository, realtime });

    await expectApplicationError(
      addMembers(addInput(["existing-a", "existing-b"])),
      400,
      "alice,bob already exists in members of this chat",
    );

    expect(repository.listMemberIdsForAddition).not.toHaveBeenCalled();
    expect(repository.addMembers).not.toHaveBeenCalled();
    expect(realtime.joinMembers).not.toHaveBeenCalled();
  });

  it("does not add a guard or normalization for an empty member array", async () => {
    const repository = createAddRepository();
    const realtime = createRealtime();
    repository.findMemberPublicDetails.mockResolvedValue([]);
    const addMembers = createChatMemberAdder({ repository, realtime });

    const result = await addMembers(addInput([]));

    expect(repository.addMembers).toHaveBeenCalledWith(ROUTE_CHAT_ID, []);
    expect(repository.findMemberPublicDetails).toHaveBeenCalledWith([]);
    expect(realtime.joinMembers).toHaveBeenCalledWith([], AUTHORIZED_CHAT_ID);
    expect(realtime.emitNewChatToMembers).toHaveBeenCalledWith([], expect.any(Object));
    expect(realtime.emitMembersAdded).toHaveBeenCalledWith(
      [ADMIN_ID, "old-member"],
      { chatId: AUTHORIZED_CHAT_ID, members: [] },
    );
    expect(result).toEqual({ chatId: AUTHORIZED_CHAT_ID, members: [] });
  });

  it("preserves the skeletal NEW_CHAT payload when the updated-chat lookup returns null", async () => {
    const repository = createAddRepository();
    const realtime = createRealtime();
    repository.findChatForAddedMemberPayload.mockResolvedValue(null);
    const addMembers = createChatMemberAdder({ repository, realtime });

    await addMembers(addInput());

    expect(realtime.emitNewChatToMembers).toHaveBeenCalledWith(["new-member"], {
      typingUsers: [],
      UnreadMessages: [],
    });
    expect(realtime.emitMembersAdded).toHaveBeenCalledOnce();
  });

  it("forwards duplicate-query failure unchanged and stops", async () => {
    const repository = createAddRepository();
    const realtime = createRealtime();
    const error = new Error("duplicate query failure");
    repository.findExistingRequestedMemberUsernames.mockRejectedValue(error);

    await expect(createChatMemberAdder({ repository, realtime })(addInput()))
      .rejects.toBe(error);

    expect(repository.listMemberIdsForAddition).not.toHaveBeenCalled();
    expect(repository.addMembers).not.toHaveBeenCalled();
  });

  it("forwards old-member snapshot failure unchanged before insertion", async () => {
    const repository = createAddRepository();
    const realtime = createRealtime();
    const error = new Error("old snapshot failure");
    repository.listMemberIdsForAddition.mockRejectedValue(error);

    await expect(createChatMemberAdder({ repository, realtime })(addInput()))
      .rejects.toBe(error);

    expect(repository.addMembers).not.toHaveBeenCalled();
    expect(repository.findMemberPublicDetails).not.toHaveBeenCalled();
  });

  it("forwards insertion failure unchanged before post-insert reads", async () => {
    const repository = createAddRepository();
    const realtime = createRealtime();
    const error = new Error("insert failure");
    repository.addMembers.mockRejectedValue(error);

    await expect(createChatMemberAdder({ repository, realtime })(addInput()))
      .rejects.toBe(error);

    expect(repository.findMemberPublicDetails).not.toHaveBeenCalled();
    expect(repository.findChatForAddedMemberPayload).not.toHaveBeenCalled();
    expect(realtime.joinMembers).not.toHaveBeenCalled();
  });

  it("keeps insertion complete when public-detail lookup fails", async () => {
    const repository = createAddRepository();
    const realtime = createRealtime();
    const error = new Error("public detail failure");
    repository.findMemberPublicDetails.mockRejectedValue(error);

    await expect(createChatMemberAdder({ repository, realtime })(addInput()))
      .rejects.toBe(error);

    expect(repository.addMembers).toHaveBeenCalledOnce();
    expect(repository.findChatForAddedMemberPayload).not.toHaveBeenCalled();
    expect(realtime.joinMembers).not.toHaveBeenCalled();
  });

  it("keeps insertion complete when updated-chat lookup fails", async () => {
    const repository = createAddRepository();
    const realtime = createRealtime();
    const error = new Error("updated chat failure");
    repository.findChatForAddedMemberPayload.mockRejectedValue(error);

    await expect(createChatMemberAdder({ repository, realtime })(addInput()))
      .rejects.toBe(error);

    expect(repository.addMembers).toHaveBeenCalledOnce();
    expect(repository.findMemberPublicDetails).toHaveBeenCalledOnce();
    expect(realtime.joinMembers).not.toHaveBeenCalled();
  });

  it("stops both events when joining members fails", async () => {
    const repository = createAddRepository();
    const realtime = createRealtime();
    const error = new Error("join failure");
    vi.mocked(realtime.joinMembers).mockImplementation(() => {
      throw error;
    });

    await expect(createChatMemberAdder({ repository, realtime })(addInput()))
      .rejects.toBe(error);

    expect(realtime.emitNewChatToMembers).not.toHaveBeenCalled();
    expect(realtime.emitMembersAdded).not.toHaveBeenCalled();
  });

  it("stops the old-member event when NEW_CHAT delivery fails", async () => {
    const repository = createAddRepository();
    const realtime = createRealtime();
    const error = new Error("new chat delivery failure");
    vi.mocked(realtime.emitNewChatToMembers).mockImplementation(() => {
      throw error;
    });

    await expect(createChatMemberAdder({ repository, realtime })(addInput()))
      .rejects.toBe(error);

    expect(realtime.joinMembers).toHaveBeenCalledOnce();
    expect(realtime.emitMembersAdded).not.toHaveBeenCalled();
  });

  it("forwards NEW_MEMBER_ADDED delivery failure after earlier effects", async () => {
    const repository = createAddRepository();
    const realtime = createRealtime();
    const error = new Error("members-added delivery failure");
    vi.mocked(realtime.emitMembersAdded).mockImplementation(() => {
      throw error;
    });

    await expect(createChatMemberAdder({ repository, realtime })(addInput()))
      .rejects.toBe(error);

    expect(realtime.joinMembers).toHaveBeenCalledOnce();
    expect(realtime.emitNewChatToMembers).toHaveBeenCalledOnce();
  });
});

describe("remove-chat-members application", () => {
  it("uses route chat ID, preserves duplicate member IDs, and orders delete and realtime effects exactly", async () => {
    const repository = createRemoveRepository();
    const realtime = createRealtime();
    const removeMembers = createChatMemberRemover({ repository, realtime });
    const memberIds = ["member-3", "member-3"];

    const result = await removeMembers(removeInput(memberIds));

    expect(repository.listMemberIdsForRemoval).toHaveBeenCalledWith(ROUTE_CHAT_ID);
    expect(repository.updateAdmin).not.toHaveBeenCalled();
    expect(repository.deleteMembers).toHaveBeenCalledWith(ROUTE_CHAT_ID, memberIds);
    expect(realtime.disconnectMembers).toHaveBeenCalledWith(memberIds, ROUTE_CHAT_ID);
    expect(realtime.emitDeleteChat).toHaveBeenCalledWith(memberIds, {
      chatId: ROUTE_CHAT_ID,
    });
    const payload = {
      chatId: ROUTE_CHAT_ID,
      membersId: memberIds,
    };
    expect(realtime.emitMembersRemoved).toHaveBeenCalledWith(
      [ADMIN_ID, "member-1", "member-2"],
      payload,
    );
    expect(result).toEqual(payload);

    expectCalledBefore(repository.listMemberIdsForRemoval, repository.deleteMembers);
    expectCalledBefore(repository.deleteMembers, realtime.disconnectMembers);
    expectCalledBefore(realtime.disconnectMembers, realtime.emitDeleteChat);
    expectCalledBefore(realtime.emitDeleteChat, realtime.emitMembersRemoved);
  });

  it("applies exact length===3 before missing-member detection", async () => {
    const repository = createRemoveRepository();
    const realtime = createRealtime();
    repository.listMemberIdsForRemoval.mockResolvedValue([
      ADMIN_ID,
      "member-1",
      "member-2",
    ]);

    await expectApplicationError(
      createChatMemberRemover({ repository, realtime })(removeInput(["missing"])),
      400,
      "Minimum 3 members are required in a group chat",
    );

    expect(repository.updateAdmin).not.toHaveBeenCalled();
    expect(repository.deleteMembers).not.toHaveBeenCalled();
  });

  it("does not broaden the minimum guard to <=3", async () => {
    const repository = createRemoveRepository();
    const realtime = createRealtime();
    repository.listMemberIdsForRemoval.mockResolvedValue([ADMIN_ID, "member-1"]);

    const result = await createChatMemberRemover({ repository, realtime })(
      removeInput(["member-1"]),
    );

    expect(repository.deleteMembers).toHaveBeenCalledWith(
      ROUTE_CHAT_ID,
      ["member-1"],
    );
    expect(result).toEqual({ chatId: ROUTE_CHAT_ID, membersId: ["member-1"] });
  });

  it("does not add remaining-member validation and removes all four without a successor", async () => {
    const repository = createRemoveRepository();
    const realtime = createRealtime();
    const memberIds = [ADMIN_ID, "member-1", "member-2", "member-3"];

    const result = await createChatMemberRemover({ repository, realtime })(
      removeInput(memberIds),
    );

    expect(repository.updateAdmin).not.toHaveBeenCalled();
    expect(repository.deleteMembers).toHaveBeenCalledWith(ROUTE_CHAT_ID, memberIds);
    expect(realtime.emitMembersRemoved).toHaveBeenCalledWith([], {
      chatId: ROUTE_CHAT_ID,
      membersId: memberIds,
    });
    expect(result.membersId).toBe(memberIds);
  });

  it("preserves the exact misspelled missing-member error", async () => {
    const repository = createRemoveRepository();
    const realtime = createRealtime();

    await expectApplicationError(
      createChatMemberRemover({ repository, realtime })(removeInput(["missing"])),
      404,
      "Provided members to be removed dosen't exists in chat",
    );

    expect(repository.updateAdmin).not.toHaveBeenCalled();
    expect(repository.deleteMembers).not.toHaveBeenCalled();
    expect(realtime.disconnectMembers).not.toHaveBeenCalled();
  });

  it("selects the first eligible existing member in unsorted order and updates before deletion", async () => {
    const repository = createRemoveRepository();
    const realtime = createRealtime();
    repository.listMemberIdsForRemoval.mockResolvedValue([
      "remove-too",
      ADMIN_ID,
      "candidate-first",
      "candidate-second",
    ]);
    const memberIds = [ADMIN_ID, "remove-too"];

    await createChatMemberRemover({ repository, realtime })(removeInput(memberIds));

    expect(repository.updateAdmin).toHaveBeenCalledWith(
      ROUTE_CHAT_ID,
      "candidate-first",
    );
    expectCalledBefore(repository.updateAdmin, repository.deleteMembers);
    expect(realtime.emitMembersRemoved).toHaveBeenCalledWith(
      ["candidate-first", "candidate-second"],
      { chatId: ROUTE_CHAT_ID, membersId: memberIds },
    );
  });

  it("does not add an empty-removal guard", async () => {
    const repository = createRemoveRepository();
    const realtime = createRealtime();

    const result = await createChatMemberRemover({ repository, realtime })(
      removeInput([]),
    );

    expect(repository.deleteMembers).toHaveBeenCalledWith(ROUTE_CHAT_ID, []);
    expect(realtime.disconnectMembers).toHaveBeenCalledWith([], ROUTE_CHAT_ID);
    expect(realtime.emitDeleteChat).toHaveBeenCalledWith([], { chatId: ROUTE_CHAT_ID });
    expect(realtime.emitMembersRemoved).toHaveBeenCalledWith(
      [ADMIN_ID, "member-1", "member-2", "member-3"],
      { chatId: ROUTE_CHAT_ID, membersId: [] },
    );
    expect(result).toEqual({ chatId: ROUTE_CHAT_ID, membersId: [] });
  });

  it("forwards membership-list failure unchanged before writes", async () => {
    const repository = createRemoveRepository();
    const realtime = createRealtime();
    const error = new Error("member-list failure");
    repository.listMemberIdsForRemoval.mockRejectedValue(error);

    await expect(createChatMemberRemover({ repository, realtime })(removeInput()))
      .rejects.toBe(error);

    expect(repository.updateAdmin).not.toHaveBeenCalled();
    expect(repository.deleteMembers).not.toHaveBeenCalled();
  });

  it("forwards admin-update failure unchanged before deletion", async () => {
    const repository = createRemoveRepository();
    const realtime = createRealtime();
    const error = new Error("admin update failure");
    repository.updateAdmin.mockRejectedValue(error);

    await expect(createChatMemberRemover({ repository, realtime })(
      removeInput([ADMIN_ID]),
    )).rejects.toBe(error);

    expect(repository.deleteMembers).not.toHaveBeenCalled();
    expect(realtime.disconnectMembers).not.toHaveBeenCalled();
  });

  it("keeps successful admin reassignment when deletion fails", async () => {
    const repository = createRemoveRepository();
    const realtime = createRealtime();
    const error = new Error("delete failure");
    repository.deleteMembers.mockRejectedValue(error);

    await expect(createChatMemberRemover({ repository, realtime })(
      removeInput([ADMIN_ID]),
    )).rejects.toBe(error);

    expect(repository.updateAdmin).toHaveBeenCalledWith(ROUTE_CHAT_ID, "member-1");
    expectCalledBefore(repository.updateAdmin, repository.deleteMembers);
    expect(realtime.disconnectMembers).not.toHaveBeenCalled();
  });

  it("stops both events when disconnecting members fails", async () => {
    const repository = createRemoveRepository();
    const realtime = createRealtime();
    const error = new Error("disconnect failure");
    vi.mocked(realtime.disconnectMembers).mockImplementation(() => {
      throw error;
    });

    await expect(createChatMemberRemover({ repository, realtime })(removeInput()))
      .rejects.toBe(error);

    expect(repository.deleteMembers).toHaveBeenCalledOnce();
    expect(realtime.emitDeleteChat).not.toHaveBeenCalled();
    expect(realtime.emitMembersRemoved).not.toHaveBeenCalled();
  });

  it("stops MEMBER_REMOVED when DELETE_CHAT delivery fails", async () => {
    const repository = createRemoveRepository();
    const realtime = createRealtime();
    const error = new Error("delete-chat delivery failure");
    vi.mocked(realtime.emitDeleteChat).mockImplementation(() => {
      throw error;
    });

    await expect(createChatMemberRemover({ repository, realtime })(removeInput()))
      .rejects.toBe(error);

    expect(realtime.disconnectMembers).toHaveBeenCalledOnce();
    expect(realtime.emitMembersRemoved).not.toHaveBeenCalled();
  });

  it("forwards MEMBER_REMOVED failure after DELETE_CHAT delivery", async () => {
    const repository = createRemoveRepository();
    const realtime = createRealtime();
    const error = new Error("members-removed delivery failure");
    vi.mocked(realtime.emitMembersRemoved).mockImplementation(() => {
      throw error;
    });

    await expect(createChatMemberRemover({ repository, realtime })(removeInput()))
      .rejects.toBe(error);

    expect(realtime.disconnectMembers).toHaveBeenCalledOnce();
    expect(realtime.emitDeleteChat).toHaveBeenCalledOnce();
  });
});
