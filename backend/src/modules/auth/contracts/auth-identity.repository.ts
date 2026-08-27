import type {
  AuthenticatedIdentity,
  OAuthAccountIdentity,
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
  findOAuthIdentityByEmail(email: string): Promise<OAuthAccountIdentity | null>;
  createGoogleIdentity(input: CreateGoogleAccountInput): Promise<PersistedGoogleAccountIdentity>;
}
