import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.lib.js";
import type {
  AuthIdentityRepository,
  CreateGoogleAccountInput,
} from "../contracts/auth-identity.repository.js";
import { canonicalizeAccountEmail } from "../account-email.js";

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

export const GOOGLE_ACCOUNT_SELECT = {
  id: true,
  username: true,
  name: true,
  avatar: true,
  email: true,
  emailVerified: true,
  googleId: true,
} as const satisfies Prisma.UserSelect;

export const prismaAuthIdentityRepository: AuthIdentityRepository = {
  findSessionIdentityById: (userId) => prisma.user.findUnique({
    where: { id: userId },
    select: SESSION_IDENTITY_SELECT,
  }),

  findGoogleIdentityByProviderId: (googleId) => prisma.user.findUnique({
    where: { googleId },
    select: GOOGLE_ACCOUNT_SELECT,
  }),

  findGoogleIdentityByEmail: async (email) => {
    const canonicalEmail = canonicalizeAccountEmail(email);
    if (!canonicalEmail) return null;

    const matches = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "User"
      WHERE LOWER(TRIM("email")) = ${canonicalEmail}
      LIMIT 2
    `);
    if (matches.length > 1) {
      throw new Error("More than one account has the same canonical email.");
    }

    const userId = matches[0]?.id;
    return userId
      ? prisma.user.findUnique({
          where: { id: userId },
          select: GOOGLE_ACCOUNT_SELECT,
        })
      : null;
  },

  linkGoogleIdentity: async ({ userId, googleId }) => {
    const linked = await prisma.user.updateMany({
      where: { id: userId, googleId: null },
      data: { googleId },
    });

    const identity = await prisma.user.findUnique({
      where: { id: userId },
      select: GOOGLE_ACCOUNT_SELECT,
    });

    if (linked.count === 1 || identity?.googleId === googleId) {
      return identity;
    }

    return null;
  },

  createGoogleIdentity: (input: CreateGoogleAccountInput) => prisma.user.create({
    data: input,
    select: GOOGLE_ACCOUNT_SELECT,
  }),
};
