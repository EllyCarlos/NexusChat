import type {
  KeyRecoveryState,
  NotificationTokenState,
  UpdatedAvatarProfile,
} from "./user-profile.js";

export interface AvatarPersistenceInput {
  avatarUrl: string;
  avatarPublicId: string;
}

export interface UserProfileRepository {
  updateAvatar(
    userId: string,
    input: AvatarPersistenceInput,
  ): Promise<UpdatedAvatarProfile>;
  updateNotificationToken(
    userId: string,
    fcmToken: string,
  ): Promise<NotificationTokenState>;
  completeKeyRecovery(
    userId: string,
    completedAt: Date,
  ): Promise<KeyRecoveryState>;
}
