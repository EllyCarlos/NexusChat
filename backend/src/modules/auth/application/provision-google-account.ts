import { ApplicationError } from "../../../errors/application-error.js";
import type { AuthIdentityRepository } from "../contracts/auth-identity.repository.js";
import type { OAuthCallbackIdentity } from "../contracts/auth-identity.js";

export interface GoogleProfileIdentity {
  providerId: string;
  email: string;
  displayName: string;
  givenName?: string;
  avatarUrl?: string;
}

type GoogleAccountDependencies = {
  identityRepository: Pick<
    AuthIdentityRepository,
    "findOAuthIdentityByEmail" | "createGoogleIdentity"
  >;
  hashProviderId: (providerId: string, rounds: number) => Promise<string>;
  defaultAvatar: string;
};

const provisioningError = () => new ApplicationError({
  code: "GOOGLE_ACCOUNT_PROVISIONING_FAILED",
  message: "Google account provisioning failed.",
  statusCode: 500,
});

export const createGoogleAccountProvisioner = ({
  identityRepository,
  hashProviderId,
  defaultAvatar,
}: GoogleAccountDependencies) => async (
  profile: GoogleProfileIdentity,
): Promise<OAuthCallbackIdentity> => {
  if (!profile.email || !profile.displayName) {
    throw provisioningError();
  }

  try {
    const existingIdentity = await identityRepository.findOAuthIdentityByEmail(profile.email);
    if (existingIdentity) {
      return {
        ...existingIdentity,
        newUser: false,
        googleId: profile.providerId,
      };
    }

    const hashedPassword = await hashProviderId(profile.providerId, 10);
    const newIdentity = await identityRepository.createGoogleIdentity({
      username: profile.displayName,
      name: profile.givenName!,
      avatar: profile.avatarUrl || defaultAvatar,
      email: profile.email,
      hashedPassword,
      emailVerified: true,
      oAuthSignup: true,
      googleId: profile.providerId,
    });

    return { ...newIdentity, newUser: true };
  } catch {
    throw provisioningError();
  }
};
