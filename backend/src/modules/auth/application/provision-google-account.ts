import { ApplicationError } from "../../../errors/application-error.js";
import { canonicalizeAccountEmail } from "../account-email.js";
import type { AuthIdentityRepository } from "../contracts/auth-identity.repository.js";
import type { OAuthCallbackIdentity } from "../contracts/auth-identity.js";

export interface GoogleProfileIdentity {
  providerId: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  givenName?: string;
  avatarUrl?: string;
}

type GoogleAccountDependencies = {
  identityRepository: Pick<
    AuthIdentityRepository,
    | "findGoogleIdentityByProviderId"
    | "findGoogleIdentityByEmail"
    | "linkGoogleIdentity"
    | "createGoogleIdentity"
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
  const canonicalEmail = canonicalizeAccountEmail(profile.email);
  if (!profile.providerId || !canonicalEmail || !profile.displayName) {
    throw provisioningError();
  }

  try {
    const providerIdentity = await identityRepository.findGoogleIdentityByProviderId(
      profile.providerId,
    );
    if (providerIdentity) {
      if (providerIdentity.googleId !== profile.providerId) {
        throw provisioningError();
      }

      const emailIdentity = await identityRepository.findGoogleIdentityByEmail(canonicalEmail);
      if (emailIdentity && emailIdentity.id !== providerIdentity.id) {
        throw provisioningError();
      }

      return {
        ...providerIdentity,
        newUser: false,
      };
    }

    if (!profile.emailVerified) {
      throw provisioningError();
    }

    const emailIdentity = await identityRepository.findGoogleIdentityByEmail(canonicalEmail);
    if (emailIdentity) {
      if (emailIdentity.googleId) {
        throw provisioningError();
      }

      const linkedIdentity = await identityRepository.linkGoogleIdentity({
        userId: emailIdentity.id,
        googleId: profile.providerId,
      });
      if (!linkedIdentity || linkedIdentity.googleId !== profile.providerId) {
        throw provisioningError();
      }

      return {
        ...linkedIdentity,
        newUser: false,
      };
    }

    const hashedPassword = await hashProviderId(profile.providerId, 10);
    const newIdentity = await identityRepository.createGoogleIdentity({
      username: profile.displayName,
      name: profile.givenName!,
      avatar: profile.avatarUrl || defaultAvatar,
      email: canonicalEmail,
      hashedPassword,
      emailVerified: profile.emailVerified,
      oAuthSignup: true,
      googleId: profile.providerId,
    });

    return { ...newIdentity, newUser: true };
  } catch {
    throw provisioningError();
  }
};
