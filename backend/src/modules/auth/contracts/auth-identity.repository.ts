import type {
  AuthenticatedIdentity,
  PersistedGoogleAccountIdentity,
} from "./auth-identity.js";

export interface CreateGoogleAccountInput {
  username: string;
  name: string;
  avatar: string;
  email: string;
  hashedPassword: string;
  emailVerified: true;
  oAuthSignup: true;
  googleId: string;
}

export interface AuthIdentityRepository {
  findSessionIdentityById(userId: string): Promise<AuthenticatedIdentity | null>;
  findGoogleIdentityByProviderId(providerId: string): Promise<PersistedGoogleAccountIdentity | null>;
  findGoogleIdentityByEmail(email: string): Promise<PersistedGoogleAccountIdentity | null>;
  linkGoogleIdentity(input: {
    userId: string;
    googleId: string;
  }): Promise<PersistedGoogleAccountIdentity | null>;
  createGoogleIdentity(input: CreateGoogleAccountInput): Promise<PersistedGoogleAccountIdentity>;
}
