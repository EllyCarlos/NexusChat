import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.lib.js";
import type {
  AuthIdentityRepository,
  CreateGoogleAccountInput,
} from "../contracts/auth-identity.repository.js";

export const SESSION_IDENTITY_SELECT = {
  id: true,
  name: true,
  username: true,
  avatar: true,
  email: true,
  createdAt: true,
  updatedAt: true,
  emailVerified: true,
  publicKey: true,
  needsKeyRecovery: true,
  keyRecoveryCompletedAt: true,
  notificationsEnabled: true,
  verificationBadge: true,
  fcmToken: true,
  oAuthSignup: true,
} as const satisfies Prisma.UserSelect;

export const OAUTH_ACCOUNT_SELECT = {
  id: true,
  username: true,
  name: true,
  avatar: true,
  email: true,
  emailVerified: true,
} as const satisfies Prisma.UserSelect;

export const GOOGLE_ACCOUNT_SELECT = {
  ...OAUTH_ACCOUNT_SELECT,
  googleId: true,
} as const satisfies Prisma.UserSelect;

export const prismaAuthIdentityRepository: AuthIdentityRepository = {
  findSessionIdentityById: (userId) => prisma.user.findUnique({
    where: { id: userId },
    select: SESSION_IDENTITY_SELECT,
  }),

  findOAuthIdentityByEmail: (email) => prisma.user.findUnique({
    where: { email },
    select: OAUTH_ACCOUNT_SELECT,
  }),

  createGoogleIdentity: (input: CreateGoogleAccountInput) => prisma.user.create({
    data: input,
    select: GOOGLE_ACCOUNT_SELECT,
  }),
};
