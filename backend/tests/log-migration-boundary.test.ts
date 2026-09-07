import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  isLogEventName,
  MIGRATED_LOG_EVENT_NAMES,
} from "../src/observability/log-event.types.js";

const sourceRoot = resolve("src");

const listTypeScriptFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listTypeScriptFiles(path) : [path];
  }));
  return files.flat().filter((path) => extname(path) === ".ts");
};

describe("existing log migration boundary", () => {
  it("keeps every catalogued event static, unique, and bounded", () => {
    expect(new Set(MIGRATED_LOG_EVENT_NAMES).size).toBe(MIGRATED_LOG_EVENT_NAMES.length);
    for (const event of MIGRATED_LOG_EVENT_NAMES) {
      expect(isLogEventName(event)).toBe(true);
    }
  });

  it("leaves direct console access only in the guarded compatibility helper", async () => {
    const files = await listTypeScriptFiles(sourceRoot);
    const directConsoleSites = (await Promise.all(files.map(async (path) => {
      const source = await readFile(path, "utf8");
      return /console\.(?:log|warn|error|info|debug)/.test(source)
        ? relative(sourceRoot, path).replaceAll("\\", "/")
        : undefined;
    }))).filter((path): path is string => path !== undefined);

    expect(directConsoleSites).toEqual(["utils/safe-logger.utils.ts"]);
  });
});
