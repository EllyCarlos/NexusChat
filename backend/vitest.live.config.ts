import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 20_000,
    include: ["tests/live/**/*.live.ts"],
    maxWorkers: 1,
    testTimeout: 20_000,
  },
});
