import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

type FrontendPackage = {
  scripts: Record<string, string>;
};

async function readFrontendPackage(): Promise<FrontendPackage> {
  return JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as FrontendPackage;
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
});
