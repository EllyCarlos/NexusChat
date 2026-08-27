export interface AuthenticatedIdentity {
  id: string;
  name: string;
  username: string;
  avatar: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
  emailVerified: boolean;
  publicKey: string | null;
  needsKeyRecovery: boolean;
  keyRecoveryCompletedAt: Date | null;
  notificationsEnabled: boolean;
  verificationBadge: boolean;
  fcmToken: string | null;
  oAuthSignup: boolean;
  // Compatibility only: the current session query does not select this field.
  avatarCloudinaryPublicId?: string | null;
}

export type SocketAuthenticatedIdentity = Pick<
  AuthenticatedIdentity,
  "id" | "username" | "avatar"
>;

export interface OAuthAccountIdentity {
  id: string;
  username: string;
  name: string;
  avatar: string;
  email: string;
  emailVerified: boolean;
}

export interface PersistedGoogleAccountIdentity extends OAuthAccountIdentity {
  googleId: string | null;
}

export interface OAuthCallbackIdentity extends OAuthAccountIdentity {
  googleId: string | null;
  newUser: boolean;
}
