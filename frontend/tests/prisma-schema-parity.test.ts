import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertPrismaSchemaParity,
  readSchema,
} from "./support/prisma-schema-parity";

const frontendSchemaPath = resolve("prisma/schema.prisma");
const backendSchemaPath = resolve("../backend/prisma/schema.prisma");

const fixture = `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum MembershipRole {
  MEMBER
  OWNER
}

model User {
  id          String       @id @default(cuid())
  displayName String
  memberships Membership[]
}

model Membership {
  id        String         @id @default(cuid())
  userId    String
  role      MembershipRole @default(MEMBER)
  createdAt DateTime       @default(now())
  user      User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, role])
}
`;

function schema(source: string, label: string) {
  return { label, source };
}

function replaceOnce(source: string, search: string, replacement: string): string {
  const changed = source.replace(search, replacement);
  if (changed === source) {
    throw new Error(`Parity test fixture did not contain ${JSON.stringify(search)}`);
  }
  return changed;
}

async function expectDrift(mutatedMirror: string): Promise<void> {
  await expect(
    assertPrismaSchemaParity(
      schema(fixture, "fixture canonical schema"),
      schema(mutatedMirror, "fixture mirror schema"),
    ),
  ).rejects.toThrow("Prisma schema drift detected");
}

describe.concurrent("Prisma schema ownership", { timeout: 120_000 }, () => {
  it("keeps the backend runtime schema aligned with the canonical frontend schema", async () => {
    await expect(
      assertPrismaSchemaParity(
        await readSchema(frontendSchemaPath, "frontend/prisma/schema.prisma"),
        await readSchema(backendSchemaPath, "backend/prisma/schema.prisma"),
      ),
    ).resolves.toBeUndefined();
  });

  it("detects an added field", async () => {
    await expectDrift(
      replaceOnce(fixture, "  displayName String\n", "  displayName String\n  bio String?\n"),
    );
  });

  it("detects a changed field type", async () => {
    await expectDrift(replaceOnce(fixture, "  displayName String\n", "  displayName Int\n"));
  });

  it("detects a required field becoming optional", async () => {
    await expectDrift(replaceOnce(fixture, "  displayName String\n", "  displayName String?\n"));
  });

  it("detects a changed enum member", async () => {
    await expectDrift(replaceOnce(fixture, "  OWNER\n", "  ADMIN\n"));
  });

  it("detects a changed unique constraint", async () => {
    await expectDrift(
      replaceOnce(fixture, "  @@unique([userId, role])\n", "  @@unique([userId])\n"),
    );
  });

  it("detects a changed index", async () => {
    await expectDrift(
      replaceOnce(
        fixture,
        "  @@unique([userId, role])\n",
        "  @@unique([userId, role])\n  @@index([createdAt])\n",
      ),
    );
  });

  it("detects changed relation behavior", async () => {
    await expectDrift(replaceOnce(fixture, "onDelete: Cascade", "onDelete: Restrict"));
  });

  it("detects client-facing relation metadata drift", async () => {
    await expectDrift(
      replaceOnce(fixture, "  memberships Membership[]\n", "  groupMemberships Membership[]\n"),
    );
  });

  it("tolerates comments, formatting, and declaration order", async () => {
    const enumBlock = `enum MembershipRole {
  MEMBER
  OWNER
}

`;
    const reordered = replaceOnce(fixture, enumBlock, "");
    const reformatted = replaceOnce(
      reordered,
      `model User {
  id          String       @id @default(cuid())
  displayName String
  memberships Membership[]`,
      `// Comments and whitespace do not change the datamodel.
model    User    {
  memberships Membership[]
  displayName String
  id          String       @id @default(cuid())`,
    );

    await expect(
      assertPrismaSchemaParity(
        schema(fixture, "fixture canonical schema"),
        schema(`${reformatted}\n${enumBlock}`, "reformatted fixture mirror schema"),
      ),
    ).resolves.toBeUndefined();
  });

  it("tolerates the approved frontend-only Prisma configuration", async () => {
    const configuredCanonical = fixture
      .replace(
        '  provider = "prisma-client-js"',
        '  provider = "prisma-client-js"\n  previewFeatures = ["postgresqlExtensions"]',
      )
      .replace(
        '  url      = env("DATABASE_URL")',
        '  url               = env("DATABASE_URL")\n  shadowDatabaseUrl = env("SHADOW_DATABASE_URL")\n  extensions        = [uuid_ossp(map: "uuid-ossp", schema: "extensions")]',
      );

    await expect(
      assertPrismaSchemaParity(
        schema(configuredCanonical, "frontend-configured canonical schema"),
        schema(fixture, "runtime mirror schema"),
      ),
    ).resolves.toBeUndefined();
  });
});
