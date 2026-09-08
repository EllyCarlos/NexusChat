import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

type FrontendPackage = {
  scripts: Record<string, string>;
};

async function readFrontendPackage(): Promise<FrontendPackage> {
  return JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as FrontendPackage;
}

async function listEntries(directory: URL): Promise<string[]> {
  try {
    const entries = await readdir(directory, {
      recursive: true,
      withFileTypes: true,
    });
    return entries.map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

describe("database credential and migration boundary", () => {
  it("supports production schema changes only through checked-in migrations", async () => {
    const { scripts } = await readFrontendPackage();

    expect(scripts["db:push:prod"]).toBeUndefined();
    expect(scripts["migrate:prod"]).toContain("prisma migrate deploy");
    expect(scripts["migrate:prod"]).not.toContain("db push");
  });

  it("does not auto-migrate or push from application lifecycle scripts", async () => {
    const { scripts } = await readFrontendPackage();

    for (const scriptName of ["dev", "build", "start", "postinstall"]) {
      expect(scripts[scriptName], scriptName).not.toMatch(
        /prisma\s+(?:migrate|db\s+push)/,
      );
    }
  });

  it("keeps normal frontend Prisma access on the generated client", async () => {
    const prismaSource = await readFile(
      new URL("../src/lib/server/prisma.ts", import.meta.url),
      "utf8",
    );

    expect(prismaSource).toContain("from '@prisma/client'");
    expect(prismaSource).toContain("new PrismaClient(");
    expect(prismaSource).not.toMatch(/DIRECT_URL|SHADOW_DATABASE_URL/);
  });

  it("keeps migration history under the canonical frontend owner", async () => {
    const frontendEntries = await listEntries(
      new URL("../prisma/migrations/", import.meta.url),
    );
    const migrationLock = await readFile(
      new URL("../prisma/migrations/migration_lock.toml", import.meta.url),
      "utf8",
    );
    const backendEntries = await listEntries(
      new URL("../../backend/prisma/migrations/", import.meta.url),
    );

    expect(frontendEntries.some((entry) => entry.endsWith(".sql"))).toBe(true);
    expect(frontendEntries).toContain("migration_lock.toml");
    expect(migrationLock).toMatch(/^provider\s*=\s*"postgresql"\s*$/m);
    expect(backendEntries).toEqual([]);
  });

  it("validates the migration-owned Google and canonical-email indexes", async () => {
    const migration = await readFile(
      new URL(
        "../prisma/migrations/20260908090000_add_unique_google_id/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("pg_catalog.pg_index");
    expect(migration).toContain("RAISE EXCEPTION");
    expect(migration).toContain('public."User_googleId_key"');
    expect(migration).toContain("index_definition.indisunique");
    expect(migration).toContain("key_column.attname = 'googleId'");
    expect(migration).toContain('CREATE INDEX "User_canonical_email_idx"');
    expect(migration).toContain('LOWER(TRIM("email"))');
    expect(migration).toContain("NOT index_definition.indisunique");
    expect(migration).toContain("'lower(btrim(email))'");
    expect(migration).not.toContain(
      'CREATE UNIQUE INDEX "User_canonical_email_idx"',
    );
  });
});
