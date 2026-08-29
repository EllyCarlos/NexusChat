import type { AuthenticatedIdentity } from "../../auth/contracts/auth-identity.js";
import type { CurrentUserProfile } from "../contracts/user-profile.js";

export const getCurrentUser = (
  identity: AuthenticatedIdentity | undefined,
): CurrentUserProfile | null => {
  if (!identity) {
    return null;
  }

  return {
    id: identity.id,
    name: identity.name,
    username: identity.username,
    avatar: identity.avatar,
    email: identity.email,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
    emailVerified: identity.emailVerified,
    publicKey: identity.publicKey,
    needsKeyRecovery: identity.needsKeyRecovery,
    keyRecoveryCompletedAt: identity.keyRecoveryCompletedAt,
    notificationsEnabled: identity.notificationsEnabled,
    verificationBadge: identity.verificationBadge,
    fcmToken: identity.fcmToken,
    oAuthSignup: identity.oAuthSignup,
  };
};
