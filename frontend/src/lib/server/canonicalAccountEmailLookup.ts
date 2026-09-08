import "server-only";

import { canonicalizeAccountEmail } from "@/lib/shared/accountEmail";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export class AmbiguousCanonicalAccountEmailError extends Error {
  constructor() {
    super("More than one account has the same canonical email.");
    this.name = "AmbiguousCanonicalAccountEmailError";
  }
}

export const findUniqueUserIdByCanonicalEmail = async (email: string) => {
  const canonicalEmail = canonicalizeAccountEmail(email);
  if (!canonicalEmail) return null;

  const matches = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "User"
    WHERE LOWER(TRIM("email")) = ${canonicalEmail}
    LIMIT 2
  `);

  if (matches.length > 1) {
    throw new AmbiguousCanonicalAccountEmailError();
  }

  return matches[0]?.id ?? null;
};
