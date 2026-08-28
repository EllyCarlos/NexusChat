import { CustomError } from "../../../errors/application-error.js";
import { logServerError } from "../../../utils/safe-logger.utils.js";
import type { ChatAvatarMediaPort } from "../contracts/chat-avatar-media.port.js";
import type { ChatRealtimePort } from "../contracts/chat-realtime.port.js";
import type { ChatRepository } from "../contracts/chat.repository.js";
import type {
  AuthorizedChatMutationContext,
  GroupChatUpdatePayload,
  UpdatedGroupChatView,
} from "../contracts/chat.types.js";

type UpdateGroupChatDependencies = {
  repository: Pick<ChatRepository, "updateGroupChat">;
  realtime: Pick<ChatRealtimePort, "emitGroupChatUpdate">;
  avatarMedia?: ChatAvatarMediaPort;
};

export type UpdateGroupChatInput = {
  chatId: string;
  name?: string;
  authorize: () => Promise<AuthorizedChatMutationContext>;
};

export const createGroupChatUpdater = ({
  repository,
  realtime,
  avatarMedia,
}: UpdateGroupChatDependencies) => async ({
  chatId,
  name,
  authorize,
}: UpdateGroupChatInput): Promise<UpdatedGroupChatView> => {
  let uploadedAvatar: Awaited<ReturnType<ChatAvatarMediaPort["uploadAvatar"]>>;
  let avatarCommitted = false;

  try {
    if (!name && !avatarMedia) {
      throw new CustomError(
        "Either avatar or name is required for updating a chat, please provide one",
        400,
      );
    }

    const authorizedChat = await authorize();

    if (avatarMedia) {
      uploadedAvatar = await avatarMedia.uploadAvatar();
      if (!uploadedAvatar) {
        throw new Error("Group avatar upload returned no result");
      }
    }

    const updatedChat = await repository.updateGroupChat({
      chatId,
      ...(name ? { name } : {}),
      ...(uploadedAvatar ? { avatar: uploadedAvatar } : {}),
    });
    avatarCommitted = Boolean(uploadedAvatar);

    if (
      uploadedAvatar
      && authorizedChat.avatarCloudinaryPublicId
      && authorizedChat.avatarCloudinaryPublicId !== uploadedAvatar.publicId
      && avatarMedia
    ) {
      try {
        await avatarMedia.deleteAvatar(
          authorizedChat.avatarCloudinaryPublicId,
        );
      } catch (cleanupError) {
        logServerError("Previous group avatar cleanup failed.", cleanupError);
      }
    }

    const payload: GroupChatUpdatePayload = {
      chatId: updatedChat.id,
      chatAvatar: updatedChat.avatar,
      chatName: updatedChat.name,
    };

    realtime.emitGroupChatUpdate(chatId, payload);

    return updatedChat;
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
      : new CustomError("Failed to update chat", 500);
  }
};
