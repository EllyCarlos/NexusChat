import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("private message search adapter privacy boundary", () => {
  it("uses only ciphertext history/context routes and never adds a private q parameter", async () => {
    const apiSource = await readFile(
      new URL("../src/lib/client/rtk-query/message.api.ts", import.meta.url),
      "utf8",
    );

    expect(apiSource).toContain("getPrivateSearchBootstrap");
    expect(apiSource).toContain("getMessageContext");
    expect(apiSource).toContain('params:{page:1,limit}');
    expect(apiSource).toContain('params:{before,after}');
    expect(apiSource).not.toMatch(/getPrivateSearchBootstrap[\s\S]*?params\s*:\s*\{[^}]*\bq\b/);
    expect(apiSource).not.toMatch(/getMessageContext[\s\S]*?params\s*:\s*\{[^}]*\bq\b/);
  });

  it("keeps search plaintext transient and does not call the group-search adapter", async () => {
    const [engineSource, hookSource] = await Promise.all([
      readFile(new URL("../src/lib/client/privateMessageSearch.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../src/hooks/useMessages/usePrivateMessageSearch.ts", import.meta.url),
        "utf8",
      ),
    ]);
    const privateSearchSource = `${engineSource}\n${hookSource}`;

    expect(privateSearchSource).not.toMatch(/localStorage|sessionStorage|indexedDB/i);
    expect(privateSearchSource).not.toMatch(/console\.(?:log|debug|info|warn|error)/);
    expect(privateSearchSource).not.toMatch(/group.*search|searchGroupMessages|useLazy.*Group.*Search/i);
    expect(hookSource).toContain("plaintextCacheRef");
    expect(hookSource).toContain("tombstonesRef");
    expect(hookSource).toContain("activeRequestRef.current?.abort()");
  });
});
