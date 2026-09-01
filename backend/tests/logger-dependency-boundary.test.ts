import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve("src");

const listTypeScriptFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listTypeScriptFiles(path) : [path];
  }));
  return files.flat().filter((path) => extname(path) === ".ts");
};

describe("structured logging dependency boundary", () => {
  it("isolates the Pino import to the infrastructure adapter", async () => {
    const sourceFiles = await listTypeScriptFiles(sourceRoot);
    const imports: string[] = [];

    for (const path of sourceFiles) {
      const source = await readFile(path, "utf8");
      if (/from ["']pino["']|require\(["']pino["']\)/.test(source)) {
        imports.push(relative(sourceRoot, path).replaceAll("\\", "/"));
      }
    }

    expect(imports).toEqual([
      "infrastructure/logging/pino-logger.adapter.ts",
    ]);
  });

  it("keeps LoggerPort provider-neutral and without an arbitrary metadata bag", async () => {
    const source = await readFile(
      resolve("src/observability/logger.port.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/pino/i);
    expect(source).not.toContain("Record<string, unknown>");
    expect(source).not.toMatch(/\bany\b/);
    expect(source).not.toMatch(/\bError\b/);
    expect(source).toContain("LogEventFields");
  });
});
