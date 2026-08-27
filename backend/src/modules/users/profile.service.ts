import { createUserAvatarUpdater } from "./application/update-user-avatar.js";
import { cloudinaryAvatarMediaProvider } from "./infrastructure/cloudinary-avatar-media.provider.js";
import { prismaUserProfileRepository } from "./infrastructure/prisma-user-profile.repository.js";

export const updateUserAvatar = createUserAvatarUpdater({
  avatarMedia: cloudinaryAvatarMediaProvider,
  userRepository: prismaUserProfileRepository,
});
