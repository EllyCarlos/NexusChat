import { beforeEach, describe, expect, it, vi } from "vitest";

const loggerMocks = vi.hoisted(() => ({
  logServerError: vi.fn(),
}));

vi.mock("../src/utils/safe-logger.utils.js", () => ({
  logServerError: loggerMocks.logServerError,
}));

import { createGroupChatCreator } from "../src/modules/chats/application/create-group-chat.js";
import { createGroupChatUpdater } from "../src/modules/chats/application/update-group-chat.js";
import type { ChatAvatarMediaPort } from "../src/modules/chats/contracts/chat-avatar-media.port.js";
import type { ChatRealtimePort } from "../src/modules/chats/contracts/chat-realtime.port.js";
import type { ChatRepository } from "../src/modules/chats/contracts/chat.repository.js";
import type {
  AuthorizedChatMutationContext,
  CreatedGroupChatView,
  UpdatedGroupChatView,
} from "../src/modules/chats/contracts/chat.types.js";
import { CustomError } from "../src/utils/error.utils.js";

const ACTOR_ID = "actor-user";
const CHAT_ID = "chat-1";
const DEFAULT_AVATAR = "https://media.example/default-avatar.png";
const OLD_AVATAR_ID = "old-avatar-id";
const NEW_AVATAR = {
  publicId: "new-avatar-id",
  secureUrl: "https://media.example/new-avatar.png",
};

const createdChat = {
  id: CHAT_ID,
  name: "Architecture",
  avatar: DEFAULT_AVATAR,
  ChatMembers: [],
  UnreadMessages: [],
  latestMessage: null,
} as unknown as CreatedGroupChatView;

const updatedChat: UpdatedGroupChatView = {
  id: CHAT_ID,
  name: "Architecture",
  avatar: NEW_AVATAR.secureUrl,
};

const authorizedChat: AuthorizedChatMutationContext = {
  id: CHAT_ID,
  adminId: ACTOR_ID,
  avatarCloudinaryPublicId: OLD_AVATAR_ID,
};

const expectBefore = (
  first: ReturnType<typeof vi.fn>,
  second: ReturnType<typeof vi.fn>,
) => {
  expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0]);
};

const createDependencies = ({ withAvatar = false }: { withAvatar?: boolean } = {}) => {
  const repository = {
    createGroupChatWithMembers: vi.fn(async () => ({ id: CHAT_ID })),
    findCreatedGroupChat: vi.fn(async () => createdChat),
  } satisfies Pick<
    ChatRepository,
    "createGroupChatWithMembers" | "findCreatedGroupChat"
  >;
  const realtime = {
    joinMembers: vi.fn(),
    emitNewChatToRoom: vi.fn(),
  } satisfies Pick<ChatRealtimePort, "joinMembers" | "emitNewChatToRoom">;
  const avatarMedia = {
    uploadAvatar: vi.fn(async () => NEW_AVATAR),
    deleteAvatar: vi.fn(async () => undefined),
  } satisfies ChatAvatarMediaPort;

  return {
    repository,
    realtime,
    avatarMedia,
    create: createGroupChatCreator({
      repository,
      realtime,
      ...(withAvatar ? { avatarMedia } : {}),
      defaultAvatar: DEFAULT_AVATAR,
    }),
  };
};

const updateDependencies = ({ withAvatar = false }: { withAvatar?: boolean } = {}) => {
  const repository = {
    updateGroupChat: vi.fn(async () => updatedChat),
  } satisfies Pick<ChatRepository, "updateGroupChat">;
  const realtime = {
    emitGroupChatUpdate: vi.fn(),
  } satisfies Pick<ChatRealtimePort, "emitGroupChatUpdate">;
  const avatarMedia = {
    uploadAvatar: vi.fn(async () => NEW_AVATAR),
    deleteAvatar: vi.fn(async () => undefined),
  } satisfies ChatAvatarMediaPort;
  const authorize = vi.fn(async () => authorizedChat);

  return {
    repository,
    realtime,
    avatarMedia,
    authorize,
    update: createGroupChatUpdater({
      repository,
      realtime,
      ...(withAvatar ? { avatarMedia } : {}),
    }),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createGroupChatCreator", () => {
  it.each([
    [
      "non-group input",
      { isGroupChat: "false", members: ["member-1", "member-2"], name: "Direct" },
      "Only group chats can be created through this endpoint",
    ],
    [
      "fewer than two supplied members",
      { isGroupChat: "true", members: ["member-1"], name: "Small" },
      "Atleast 2 members are required to create group chat",
    ],
    [
      "a missing name",
      { isGroupChat: "true", members: ["member-1", "member-2"] },
      "name is required for creating group chat",
    ],
  ])("rejects %s before persistence and realtime", async (_label, input, message) => {
    const { create, repository, realtime } = createDependencies();

    await expect(create({ actorId: ACTOR_ID, ...input })).rejects.toMatchObject({
      statusCode: 400,
      message,
    });

    expect(repository.createGroupChatWithMembers).not.toHaveBeenCalled();
    expect(repository.findCreatedGroupChat).not.toHaveBeenCalled();
    expect(realtime.joinMembers).not.toHaveBeenCalled();
    expect(realtime.emitNewChatToRoom).not.toHaveBeenCalled();
  });

  it("uses the default avatar, preserves duplicates, appends the actor, and orders persistence before realtime", async () => {
    const { create, repository, realtime } = createDependencies();
    const suppliedMembers = ["member-1", ACTOR_ID, "member-1"];
    const memberIds = [...suppliedMembers, ACTOR_ID];

    const result = await create({
      actorId: ACTOR_ID,
      isGroupChat: "true",
      members: suppliedMembers,
      name: "Architecture",
    });

    expect(repository.createGroupChatWithMembers).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      avatar: DEFAULT_AVATAR,
      avatarCloudinaryPublicId: null,
      memberIds,
      name: "Architecture",
    });
    expect(repository.findCreatedGroupChat).toHaveBeenCalledWith(CHAT_ID, ACTOR_ID);
    const payload = { ...createdChat, typingUsers: [] };
    expect(realtime.joinMembers).toHaveBeenCalledWith(memberIds, CHAT_ID);
    expect(realtime.emitNewChatToRoom).toHaveBeenCalledWith(CHAT_ID, payload);
    expectBefore(repository.createGroupChatWithMembers, repository.findCreatedGroupChat);
    expectBefore(repository.findCreatedGroupChat, realtime.joinMembers);
    expectBefore(realtime.joinMembers, realtime.emitNewChatToRoom);
    expect(result).toEqual(payload);
  });

  it("uploads a custom avatar before persistence and commits both mapped fields", async () => {
    const { create, repository, avatarMedia } = createDependencies({ withAvatar: true });

    await create({
      actorId: ACTOR_ID,
      isGroupChat: "true",
      members: ["member-1", "member-2"],
      name: "Architecture",
    });

    expect(avatarMedia.uploadAvatar).toHaveBeenCalledOnce();
    expect(repository.createGroupChatWithMembers).toHaveBeenCalledWith(expect.objectContaining({
      avatar: NEW_AVATAR.secureUrl,
      avatarCloudinaryPublicId: NEW_AVATAR.publicId,
    }));
    expectBefore(avatarMedia.uploadAvatar, repository.createGroupChatWithMembers);
    expect(avatarMedia.deleteAvatar).not.toHaveBeenCalled();
  });

  it("maps a missing media result to the generic create error before persistence", async () => {
    const { create, repository, avatarMedia } = createDependencies({ withAvatar: true });
    avatarMedia.uploadAvatar.mockResolvedValue(undefined);

    await expect(create({
      actorId: ACTOR_ID,
      isGroupChat: "true",
      members: ["member-1", "member-2"],
      name: "Architecture",
    })).rejects.toMatchObject({
      statusCode: 500,
      message: "Failed to create group chat",
    });

    expect(repository.createGroupChatWithMembers).not.toHaveBeenCalled();
    expect(avatarMedia.deleteAvatar).not.toHaveBeenCalled();
  });

  it("rolls back an uploaded avatar when transactional persistence rejects", async () => {
    const { create, repository, realtime, avatarMedia } = createDependencies({ withAvatar: true });
    repository.createGroupChatWithMembers.mockRejectedValue(new Error("database details"));

    await expect(create({
      actorId: ACTOR_ID,
      isGroupChat: "true",
      members: ["member-1", "member-2"],
      name: "Architecture",
    })).rejects.toMatchObject({
      statusCode: 500,
      message: "Failed to create group chat",
    });

    expect(avatarMedia.deleteAvatar).toHaveBeenCalledWith(NEW_AVATAR.publicId);
    expect(repository.findCreatedGroupChat).not.toHaveBeenCalled();
    expect(realtime.joinMembers).not.toHaveBeenCalled();
  });

  it("safe-logs rollback rejection without replacing the generic create failure", async () => {
    const rollbackError = new Error("provider rollback details");
    const { create, repository, avatarMedia } = createDependencies({ withAvatar: true });
    repository.createGroupChatWithMembers.mockRejectedValue(new Error("database details"));
    avatarMedia.deleteAvatar.mockRejectedValue(rollbackError);

    await expect(create({
      actorId: ACTOR_ID,
      isGroupChat: "true",
      members: ["member-1", "member-2"],
      name: "Architecture",
    })).rejects.toMatchObject({
      statusCode: 500,
      message: "Failed to create group chat",
    });

    expect(loggerMocks.logServerError).toHaveBeenCalledWith(
      "New group avatar rollback failed.",
      rollbackError,
    );
  });

  it("does not roll back the committed avatar when the populated query fails", async () => {
    const { create, repository, realtime, avatarMedia } = createDependencies({ withAvatar: true });
    repository.findCreatedGroupChat.mockRejectedValue(new Error("query details"));

    await expect(create({
      actorId: ACTOR_ID,
      isGroupChat: "true",
      members: ["member-1", "member-2"],
      name: "Architecture",
    })).rejects.toMatchObject({
      statusCode: 500,
      message: "Failed to create group chat",
    });

    expect(avatarMedia.deleteAvatar).not.toHaveBeenCalled();
    expect(realtime.joinMembers).not.toHaveBeenCalled();
    expect(realtime.emitNewChatToRoom).not.toHaveBeenCalled();
  });

  it("stops at a join failure and keeps committed persistence and media", async () => {
    const { create, realtime, avatarMedia } = createDependencies({ withAvatar: true });
    realtime.joinMembers.mockImplementation(() => {
      throw new Error("join details");
    });

    await expect(create({
      actorId: ACTOR_ID,
      isGroupChat: "true",
      members: ["member-1", "member-2"],
      name: "Architecture",
    })).rejects.toMatchObject({ message: "Failed to create group chat" });

    expect(realtime.emitNewChatToRoom).not.toHaveBeenCalled();
    expect(avatarMedia.deleteAvatar).not.toHaveBeenCalled();
  });

  it("keeps joined members and committed media when NEW_CHAT emission fails", async () => {
    const { create, realtime, avatarMedia } = createDependencies({ withAvatar: true });
    realtime.emitNewChatToRoom.mockImplementation(() => {
      throw new Error("emit details");
    });

    await expect(create({
      actorId: ACTOR_ID,
      isGroupChat: "true",
      members: ["member-1", "member-2"],
      name: "Architecture",
    })).rejects.toMatchObject({ message: "Failed to create group chat" });

    expect(realtime.joinMembers).toHaveBeenCalledOnce();
    expect(avatarMedia.deleteAvatar).not.toHaveBeenCalled();
  });
});

describe("createGroupChatUpdater", () => {
  it("checks the no-name/no-avatar guard before invoking authorization", async () => {
    const { update, authorize, repository, realtime } = updateDependencies();

    await expect(update({ chatId: CHAT_ID, authorize })).rejects.toMatchObject({
      statusCode: 400,
      message: "Either avatar or name is required for updating a chat, please provide one",
    });

    expect(authorize).not.toHaveBeenCalled();
    expect(repository.updateGroupChat).not.toHaveBeenCalled();
    expect(realtime.emitGroupChatUpdate).not.toHaveBeenCalled();
  });

  it("invokes authorization inside the error boundary and preserves its CustomError", async () => {
    const { update, authorize, repository } = updateDependencies();
    const authorizationError = new CustomError(
      "Group administrator permission is required",
      403,
    );
    authorize.mockRejectedValue(authorizationError);

    await expect(update({
      chatId: CHAT_ID,
      name: "Renamed",
      authorize,
    })).rejects.toBe(authorizationError);

    expect(repository.updateGroupChat).not.toHaveBeenCalled();
  });

  it("maps an unexpected authorization failure to the generic update error", async () => {
    const { update, authorize } = updateDependencies();
    authorize.mockRejectedValue(new Error("authorization internals"));

    await expect(update({
      chatId: CHAT_ID,
      name: "Renamed",
      authorize,
    })).rejects.toMatchObject({
      statusCode: 500,
      message: "Failed to update chat",
    });
  });

  it("performs the exact name-only operation before emitting the exact room payload", async () => {
    const { update, authorize, repository, realtime } = updateDependencies();

    const result = await update({
      chatId: CHAT_ID,
      name: "Renamed",
      authorize,
    });

    expect(authorize).toHaveBeenCalledOnce();
    expect(repository.updateGroupChat).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      name: "Renamed",
    });
    expect(realtime.emitGroupChatUpdate).toHaveBeenCalledWith(CHAT_ID, {
      chatId: CHAT_ID,
      chatAvatar: NEW_AVATAR.secureUrl,
      chatName: "Architecture",
    });
    expectBefore(authorize, repository.updateGroupChat);
    expectBefore(repository.updateGroupChat, realtime.emitGroupChatUpdate);
    expect(result).toBe(updatedChat);
  });

  it("uploads, persists, deletes the old avatar, then emits in exact order", async () => {
    const { update, authorize, repository, realtime, avatarMedia } = updateDependencies({ withAvatar: true });

    await update({ chatId: CHAT_ID, authorize });

    expect(repository.updateGroupChat).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      avatar: NEW_AVATAR,
    });
    expect(avatarMedia.deleteAvatar).toHaveBeenCalledWith(OLD_AVATAR_ID);
    expect(realtime.emitGroupChatUpdate).toHaveBeenCalledWith(CHAT_ID, {
      chatId: CHAT_ID,
      chatAvatar: NEW_AVATAR.secureUrl,
      chatName: "Architecture",
    });
    expectBefore(authorize, avatarMedia.uploadAvatar);
    expectBefore(avatarMedia.uploadAvatar, repository.updateGroupChat);
    expectBefore(repository.updateGroupChat, avatarMedia.deleteAvatar);
    expectBefore(avatarMedia.deleteAvatar, realtime.emitGroupChatUpdate);
  });

  it("passes both conditional name and avatar fields when both are supplied", async () => {
    const { update, authorize, repository } = updateDependencies({ withAvatar: true });

    await update({
      chatId: CHAT_ID,
      name: "Renamed",
      authorize,
    });

    expect(repository.updateGroupChat).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      name: "Renamed",
      avatar: NEW_AVATAR,
    });
  });

  it("maps a missing media result before DB mutation", async () => {
    const { update, authorize, repository, realtime, avatarMedia } = updateDependencies({ withAvatar: true });
    avatarMedia.uploadAvatar.mockResolvedValue(undefined);

    await expect(update({ chatId: CHAT_ID, authorize })).rejects.toMatchObject({
      statusCode: 500,
      message: "Failed to update chat",
    });

    expect(repository.updateGroupChat).not.toHaveBeenCalled();
    expect(avatarMedia.deleteAvatar).not.toHaveBeenCalled();
    expect(realtime.emitGroupChatUpdate).not.toHaveBeenCalled();
  });

  it("rolls back the new avatar when the non-transactional DB update fails", async () => {
    const { update, authorize, repository, realtime, avatarMedia } = updateDependencies({ withAvatar: true });
    repository.updateGroupChat.mockRejectedValue(new Error("database details"));

    await expect(update({ chatId: CHAT_ID, authorize })).rejects.toMatchObject({
      statusCode: 500,
      message: "Failed to update chat",
    });

    expect(avatarMedia.deleteAvatar).toHaveBeenCalledWith(NEW_AVATAR.publicId);
    expect(avatarMedia.deleteAvatar).not.toHaveBeenCalledWith(OLD_AVATAR_ID);
    expect(realtime.emitGroupChatUpdate).not.toHaveBeenCalled();
  });

  it("safe-logs new-avatar rollback rejection and preserves the generic error", async () => {
    const rollbackError = new Error("provider rollback details");
    const { update, authorize, repository, avatarMedia } = updateDependencies({ withAvatar: true });
    repository.updateGroupChat.mockRejectedValue(new Error("database details"));
    avatarMedia.deleteAvatar.mockRejectedValue(rollbackError);

    await expect(update({ chatId: CHAT_ID, authorize })).rejects.toMatchObject({
      message: "Failed to update chat",
    });

    expect(loggerMocks.logServerError).toHaveBeenCalledWith(
      "New group avatar rollback failed.",
      rollbackError,
    );
  });

  it.each([
    ["there is no old provider ID", null],
    ["the provider IDs match", NEW_AVATAR.publicId],
  ])("skips old-avatar cleanup when %s", async (_label, previousAvatarId) => {
    const { update, authorize, realtime, avatarMedia } = updateDependencies({ withAvatar: true });
    authorize.mockResolvedValue({
      ...authorizedChat,
      avatarCloudinaryPublicId: previousAvatarId,
    });

    await update({ chatId: CHAT_ID, authorize });

    expect(avatarMedia.deleteAvatar).not.toHaveBeenCalled();
    expect(realtime.emitGroupChatUpdate).toHaveBeenCalledOnce();
  });

  it("safe-logs old-avatar cleanup rejection and continues to realtime success", async () => {
    const cleanupError = new Error("provider cleanup details");
    const { update, authorize, realtime, avatarMedia } = updateDependencies({ withAvatar: true });
    avatarMedia.deleteAvatar.mockRejectedValue(cleanupError);

    await expect(update({ chatId: CHAT_ID, authorize })).resolves.toBe(updatedChat);

    expect(loggerMocks.logServerError).toHaveBeenCalledWith(
      "Previous group avatar cleanup failed.",
      cleanupError,
    );
    expect(realtime.emitGroupChatUpdate).toHaveBeenCalledOnce();
  });

  it("does not roll back the committed avatar when realtime emission fails", async () => {
    const { update, authorize, repository, realtime, avatarMedia } = updateDependencies({ withAvatar: true });
    realtime.emitGroupChatUpdate.mockImplementation(() => {
      throw new Error("socket details");
    });

    await expect(update({ chatId: CHAT_ID, authorize })).rejects.toMatchObject({
      statusCode: 500,
      message: "Failed to update chat",
    });

    expect(repository.updateGroupChat).toHaveBeenCalledOnce();
    expect(avatarMedia.deleteAvatar).toHaveBeenCalledWith(OLD_AVATAR_ID);
    expect(avatarMedia.deleteAvatar).not.toHaveBeenCalledWith(NEW_AVATAR.publicId);
  });
});
