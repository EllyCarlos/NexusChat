import { ApplicationError } from "../../../errors/application-error.js";
import type { UserProfileRepository } from "../contracts/user-profile.repository.js";
import type { KeyRecoveryState } from "../contracts/user-profile.js";

type KeyRecoveryDependencies = {
  userRepository: Pick<UserProfileRepository, "completeKeyRecovery">;
  now: () => Date;
};

const keyRecoveryError = () => new ApplicationError({
  code: "USER_KEY_RECOVERY_STATE_UPDATE_FAILED",
  message: "Failed to complete private key recovery.",
  statusCode: 500,
});

export const createKeyRecoveryCompleter = ({
  userRepository,
  now,
}: KeyRecoveryDependencies) => async ({
  userId,
}: {
  userId: string;
}): Promise<KeyRecoveryState> => {
  try {
    return await userRepository.completeKeyRecovery(userId, now());
  } catch {
    throw keyRecoveryError();
  }
};
