import { ApplicationError } from "../../../errors/application-error.js";
import type { UserProfileRepository } from "../contracts/user-profile.repository.js";
import type { NotificationTokenState } from "../contracts/user-profile.js";

type NotificationTokenDependencies = {
  userRepository: Pick<UserProfileRepository, "updateNotificationToken">;
};

const notificationTokenError = () => new ApplicationError({
  code: "USER_NOTIFICATION_TOKEN_UPDATE_FAILED",
  message: "Internal server error",
  statusCode: 500,
});

export const createNotificationTokenUpdater = ({
  userRepository,
}: NotificationTokenDependencies) => async ({
  userId,
  fcmToken,
}: {
  userId: string;
  fcmToken: string;
}): Promise<NotificationTokenState> => {
  try {
    return await userRepository.updateNotificationToken(userId, fcmToken);
  } catch {
    throw notificationTokenError();
  }
};
