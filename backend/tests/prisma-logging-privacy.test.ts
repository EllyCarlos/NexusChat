import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Prisma logging privacy", () => {
  it("constructs Prisma without raw built-in query, error, or warning logging", async () => {
    const source = await readFile(resolve("src/lib/prisma.lib.ts"), "utf8");

    expect(source).toContain("new PrismaClient()");
    expect(source).not.toMatch(/\blog\s*:/);
    expect(source).not.toContain("'query'");
    expect(source).not.toContain("'error'");
    expect(source).not.toContain("'warn'");
    expect(source).not.toMatch(/\$on\s*\(\s*["']query["']/);
  });
});
