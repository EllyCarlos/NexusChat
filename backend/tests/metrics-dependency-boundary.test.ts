import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve("src");

const productionFiles = async (): Promise<string[]> => {
  const { glob } = await import("node:fs/promises");
  const files: string[] = [];
  for await (const path of glob("**/*.ts", { cwd: sourceRoot })) files.push(path);
  return files;
};

describe("metrics dependency boundary", () => {
  it("keeps the project-owned contract provider-neutral and explicit", async () => {
    const source = await readFile(resolve(sourceRoot, "observability/metrics.port.ts"), "utf8");

    expect(source).not.toMatch(/prom-client|express|Counter|Gauge|Histogram|Registry/);
    expect(source).toContain("startHttpRequest");
    expect(source).toContain("HttpRequestMetricCompletion");
    expect(source).not.toMatch(/increment\(name|observe\(name|set\(name|Record<string,\s*string>/);
  });

  it("confines the sole direct prom-client import to infrastructure", async () => {
    const importingFiles: string[] = [];
    for (const path of await productionFiles()) {
      const source = await readFile(resolve(sourceRoot, path), "utf8");
      if (/from ["']prom-client["']|require\(["']prom-client["']\)/.test(source)) {
        importingFiles.push(relative(sourceRoot, resolve(sourceRoot, path)).replaceAll("\\", "/"));
      }
    }

    expect(importingFiles).toEqual([
      "infrastructure/metrics/prometheus-metrics.adapter.ts",
    ]);
  });

  it("uses neither the default registry nor automatic process metrics", async () => {
    const source = await readFile(
      resolve(sourceRoot, "infrastructure/metrics/prometheus-metrics.adapter.ts"),
      "utf8",
    );

    expect(source).toContain("const registry = new Registry()");
    expect(source).not.toMatch(/register\.clear|collectDefaultMetrics|\bregister\b[,}]/);
  });
});
