import type { AuthenticatedIdentity } from "../../auth/contracts/auth-identity.js";

export type CurrentUserProfile = Omit<
  AuthenticatedIdentity,
  "avatarCloudinaryPublicId"
>;

export type UpdatedAvatarProfile = Omit<
  CurrentUserProfile,
  "needsKeyRecovery" | "keyRecoveryCompletedAt"
>;

export interface NotificationTokenState {
  fcmToken: string | null;
}

export interface KeyRecoveryState {
  id: string;
  needsKeyRecovery: boolean;
  keyRecoveryCompletedAt: Date | null;
}

export interface AvatarUploadSource {
  path: string;
}

export interface UploadedAvatar {
  publicId: string;
  secureUrl: string;
}
