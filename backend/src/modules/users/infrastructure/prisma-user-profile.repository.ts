import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.lib.js";
import type {
  AvatarPersistenceInput,
  UserProfileRepository,
} from "../contracts/user-profile.repository.js";

export const UPDATED_AVATAR_PROFILE_SELECT = {
  id: true,
  name: true,
  username: true,
  avatar: true,
  email: true,
  createdAt: true,
  updatedAt: true,
  emailVerified: true,
  publicKey: true,
  notificationsEnabled: true,
  verificationBadge: true,
  fcmToken: true,
  oAuthSignup: true,
} as const satisfies Prisma.UserSelect;

export const NOTIFICATION_TOKEN_SELECT = {
  fcmToken: true,
} as const satisfies Prisma.UserSelect;

export const KEY_RECOVERY_STATE_SELECT = {
  id: true,
  needsKeyRecovery: true,
  keyRecoveryCompletedAt: true,
} as const satisfies Prisma.UserSelect;

export const prismaUserProfileRepository: UserProfileRepository = {
  updateAvatar: (userId, input: AvatarPersistenceInput) => prisma.user.update({
    where: { id: userId },
    data: {
      avatar: input.avatarUrl,
      avatarCloudinaryPublicId: input.avatarPublicId,
    },
    select: UPDATED_AVATAR_PROFILE_SELECT,
  }),

  updateNotificationToken: (userId, fcmToken) => prisma.user.update({
    where: { id: userId },
    data: { fcmToken },
    select: NOTIFICATION_TOKEN_SELECT,
  }),

  completeKeyRecovery: (userId, completedAt) => prisma.user.update({
    where: { id: userId },
    data: {
      needsKeyRecovery: false,
      keyRecoveryCompletedAt: completedAt,
    },
    select: KEY_RECOVERY_STATE_SELECT,
  }),
};
