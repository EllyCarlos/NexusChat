import { CustomError } from "../../../errors/application-error.js";
import { logServerError } from "../../../utils/safe-logger.utils.js";
import type { ChatAvatarMediaPort } from "../contracts/chat-avatar-media.port.js";
import type { ChatRealtimePort } from "../contracts/chat-realtime.port.js";
import type { ChatRepository } from "../contracts/chat.repository.js";
import type { CreatedGroupChatPayload } from "../contracts/chat.types.js";

type CreateGroupChatDependencies = {
  repository: Pick<
    ChatRepository,
    "createGroupChatWithMembers" | "findCreatedGroupChat"
  >;
  realtime: Pick<ChatRealtimePort, "joinMembers" | "emitNewChatToRoom">;
  avatarMedia?: ChatAvatarMediaPort;
  defaultAvatar: string;
};

export type CreateGroupChatInput = {
  actorId: string;
  isGroupChat: string;
  members: string[];
  name?: string;
};

export const createGroupChatCreator = ({
  repository,
  realtime,
  avatarMedia,
  defaultAvatar,
}: CreateGroupChatDependencies) => async ({
  actorId,
  isGroupChat,
  members,
  name,
}: CreateGroupChatInput): Promise<CreatedGroupChatPayload> => {
  let uploadedAvatar: Awaited<ReturnType<ChatAvatarMediaPort["uploadAvatar"]>>;
  let avatarCommitted = false;

  try {
    if (isGroupChat !== "true") {
      throw new CustomError(
        "Only group chats can be created through this endpoint",
        400,
      );
    }

    if (members.length < 2) {
      throw new CustomError(
        "Atleast 2 members are required to create group chat",
        400,
      );
    }

    if (!name) {
      throw new CustomError(
        "name is required for creating group chat",
        400,
      );
    }

    const memberIds = [...members, actorId];

    if (avatarMedia) {
      uploadedAvatar = await avatarMedia.uploadAvatar();
      if (!uploadedAvatar) {
        throw new Error("Group avatar upload returned no result");
      }
    }

    const newChat = await repository.createGroupChatWithMembers({
      actorId,
      avatar: uploadedAvatar?.secureUrl ?? defaultAvatar,
      avatarCloudinaryPublicId: uploadedAvatar?.publicId ?? null,
      memberIds,
      name,
    });
    avatarCommitted = true;

    const populatedChat = await repository.findCreatedGroupChat(
      newChat.id,
      actorId,
    );
    const payload = {
      ...populatedChat,
      typingUsers: [],
    } as CreatedGroupChatPayload;

    await realtime.joinMembers(memberIds, newChat.id);
    realtime.emitNewChatToRoom(newChat.id, payload);

    return payload;
  } catch (error) {
    if (!avatarCommitted && uploadedAvatar && avatarMedia) {
      try {
        await avatarMedia.deleteAvatar(uploadedAvatar.publicId);
      } catch (cleanupError) {
        logServerError("New group avatar rollback failed.", cleanupError);
      }
    }

    throw error instanceof CustomError
      ? error
      : new CustomError("Failed to create group chat", 500);
  }
};
