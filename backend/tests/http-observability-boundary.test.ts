import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFile(resolve(path), "utf8");

describe("HTTP observability static boundary", () => {
  it("keeps request context minimal, provider-neutral, and ALS-backed", async () => {
    const source = await readSource("src/observability/request-context.ts");

    expect(source).toContain('from "node:async_hooks"');
    expect(source).toContain("new AsyncLocalStorage<RequestContext>()");
    expect(source).toMatch(/interface RequestContext\s*{\s*readonly requestId: string;\s*}/);
    expect(source).not.toMatch(/pino|express|userId|email|token|headers|cookies|body|query|\bip\b/i);
  });

  it("has no raw request URL or path fallback in completion logging", async () => {
    const source = await readSource("src/middlewares/http-observability.middleware.ts");

    expect(source).not.toContain("request.originalUrl");
    expect(source).not.toContain("request.url");
    expect(source).not.toContain("request.path");
    expect(source).not.toContain("req.originalUrl");
    expect(source).not.toContain("req.url");
    expect(source).not.toContain("req.path");
    expect(source).toContain('return request.res?.statusCode === 404 ? "unmatched" : "pre_route"');
  });

  it("installs correlation before the unchanged security and parsing chain", async () => {
    const source = await readSource("src/app.ts");
    const orderedMarkers = [
      "app.use(createHttpObservabilityMiddleware({ logger }))",
      "app.use(helmet({",
      "app.use(cors({",
      "app.use(createMutationOriginMiddleware(originPolicy))",
      "app.use(passport.initialize())",
      'app.use(express.json({ limit: "10mb" }))',
      "app.use(express.urlencoded({ extended: true, limit: \"10mb\" }))",
      "app.use(cookieParser())",
      'app.use("/api/v1/auth"',
      "for (const route of routes)",
      "app.use(notFoundMiddleware)",
      "app.use(errorMiddleware)",
    ];
    const positions = orderedMarkers.map((marker) => source.indexOf(marker));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(source).toContain("exposedHeaders: [REQUEST_ID_HEADER]");
  });

  it("removes only the direct Morgan packages from package metadata", async () => {
    const packageJson = JSON.parse(await readSource("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies).not.toHaveProperty("morgan");
    expect(packageJson.devDependencies).not.toHaveProperty("@types/morgan");
    expect(JSON.stringify(packageJson)).not.toMatch(/pino-http|express-request-id|cls-hooked|prom-client/i);
  });
});
