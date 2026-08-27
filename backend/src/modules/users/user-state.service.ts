import { createKeyRecoveryCompleter } from "./application/complete-key-recovery.js";
import { createNotificationTokenUpdater } from "./application/update-notification-token.js";
import { prismaUserProfileRepository } from "./infrastructure/prisma-user-profile.repository.js";

export const updateNotificationToken = createNotificationTokenUpdater({
  userRepository: prismaUserProfileRepository,
});

export const completeUserKeyRecovery = createKeyRecoveryCompleter({
  userRepository: prismaUserProfileRepository,
  now: () => new Date(),
});
