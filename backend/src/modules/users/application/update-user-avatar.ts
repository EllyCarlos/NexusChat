import { ApplicationError } from "../../../errors/application-error.js";
import { logServerError } from "../../../utils/safe-logger.utils.js";
import type { AvatarMediaProvider } from "../contracts/avatar-media.provider.js";
import type { UserProfileRepository } from "../contracts/user-profile.repository.js";
import type {
  AvatarUploadSource,
  UpdatedAvatarProfile,
  UploadedAvatar,
} from "../contracts/user-profile.js";

type UpdateUserAvatarDependencies = {
  avatarMedia: AvatarMediaProvider;
  userRepository: Pick<UserProfileRepository, "updateAvatar">;
};

const avatarUpdateError = () => new ApplicationError({
  code: "USER_AVATAR_UPDATE_FAILED",
  message: "Failed to update user profile",
  statusCode: 500,
});

export const createUserAvatarUpdater = ({
  avatarMedia,
  userRepository,
}: UpdateUserAvatarDependencies) => async ({
  userId,
  existingAvatarPublicId,
  upload,
}: {
  userId: string;
  existingAvatarPublicId?: string | null;
  upload: AvatarUploadSource;
}): Promise<UpdatedAvatarProfile> => {
  let uploadedAvatar: UploadedAvatar | null = null;

  try {
    uploadedAvatar = await avatarMedia.uploadAvatar(upload);
    const profile = await userRepository.updateAvatar(userId, {
      avatarUrl: uploadedAvatar.secureUrl,
      avatarPublicId: uploadedAvatar.publicId,
    });

    if (
      existingAvatarPublicId
      && existingAvatarPublicId !== uploadedAvatar.publicId
    ) {
      try {
        await avatarMedia.deleteAvatar(existingAvatarPublicId);
      } catch (cleanupError) {
        logServerError("Previous avatar cleanup failed.", cleanupError);
      }
    }

    return profile;
  } catch {
    if (uploadedAvatar) {
      try {
        await avatarMedia.deleteAvatar(uploadedAvatar.publicId);
      } catch (cleanupError) {
        logServerError("Uploaded-file cleanup failed.", cleanupError);
      }
    }
    throw avatarUpdateError();
  }
};
