import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeEnvironment = vi.hoisted(() => ({
  NODE_ENV: "test" as const,
  PORT: "4000",
  JWT_SECRET: "obvious-fake-jwt-secret",
  JWT_TOKEN_EXPIRATION_DAYS: "7",
  EMAIL: "sender@example.test",
  PASSWORD: "obvious-fake-email-password",
  OTP_EXPIRATION_MINUTES: "5",
  PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES: "60",
  CLOUDINARY_CLOUD_NAME: "obvious-fake-cloud",
  CLOUDINARY_API_KEY: "obvious-fake-cloud-key",
  CLOUDINARY_API_SECRET: "obvious-fake-cloud-secret",
  GOOGLE_CLIENT_ID: "obvious-fake-google-client",
  GOOGLE_CLIENT_SECRET: "obvious-fake-google-secret",
  GOOGLE_APPLICATION_CREDENTIALS: "obvious-fake-credentials.json",
  DATABASE_URL: "postgresql://example.test/runtime",
  DIRECT_URL: "postgresql://example.test/direct",
}));

vi.mock("../src/schemas/env.schema.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/schemas/env.schema.js")>();
  return {
    ...actual,
    loadEnvironment: () => ({ ...runtimeEnvironment }),
  };
});

import { config, createRuntimeConfig } from "../src/config/env.config.js";
import { ApplicationError } from "../src/errors/application-error.js";
import {
  CONFIGURATION_ERROR_CODE,
  parseEnvironment,
} from "../src/schemas/env.schema.js";

describe("runtime configuration boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("imports reusable schema code without terminating the process", async () => {
    vi.resetModules();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await import("../src/schemas/env.schema.js");

    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("throws a catchable safe error containing variable names but no values", () => {
    const source: Record<string, string | undefined> = {
      ...runtimeEnvironment,
      NODE_ENV: "production",
      EMAIL: "obvious-invalid-email-value",
      FIREBASE_PROJECT_ID: "obvious-fake-firebase-project",
      FIREBASE_CLIENT_EMAIL: "firebase@example.test",
      FIREBASE_PRIVATE_KEY: "obvious-fake-private-key-value",
    };
    delete source.JWT_SECRET;
    delete source.CLOUDINARY_API_SECRET;
    delete source.FIREBASE_PRIVATE_KEY;

    let thrown: unknown;
    try {
      parseEnvironment(source);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApplicationError);
    expect(thrown).toMatchObject({
      code: CONFIGURATION_ERROR_CODE,
      statusCode: 500,
    });
    const message = (thrown as Error).message;
    expect(message).toContain("JWT_SECRET");
    expect(message).toContain("CLOUDINARY_API_SECRET");
    expect(message).toContain("EMAIL");
    expect(message).not.toContain("obvious-invalid-email-value");
    expect(message).not.toContain("obvious-fake-private-key-value");
    expect(JSON.stringify(thrown)).not.toContain("obvious-fake-jwt-secret");
  });

  it("requires the named Firebase variables in production without exposing values", () => {
    const source: Record<string, string | undefined> = {
      ...runtimeEnvironment,
      NODE_ENV: "production",
      FIREBASE_PROJECT_ID: "obvious-fake-firebase-project",
      FIREBASE_CLIENT_EMAIL: "firebase@example.test",
    };

    expect(() => parseEnvironment(source)).toThrow("FIREBASE_PRIVATE_KEY");
    try {
      parseEnvironment(source);
    } catch (error) {
      expect((error as Error).message).not.toContain("obvious-fake-firebase-project");
    }
  });

  it("keeps Redis optional and treats whitespace-only configuration as absent", () => {
    expect(parseEnvironment(runtimeEnvironment).REDIS_URL).toBeUndefined();
    expect(parseEnvironment({
      ...runtimeEnvironment,
      REDIS_URL: "   \t  ",
    }).REDIS_URL).toBeUndefined();
  });

  it.each([
    "redis://redis.example.test:6379",
    "rediss://redis.example.test:6380",
  ])("accepts and trims a supported Redis URL: %s", (redisUrl) => {
    const parsed = parseEnvironment({
      ...runtimeEnvironment,
      REDIS_URL: `  ${redisUrl}  `,
    });

    expect(parsed.REDIS_URL).toBe(redisUrl);
    expect(createRuntimeConfig(parsed).redis).toEqual({ url: redisUrl });
  });

  it.each([
    "http://sentinel-user:sentinel-secret@redis.example.test:6380",
    "https://sentinel-user:sentinel-secret@redis.example.test:6380",
    "not-a-redis-url",
  ])("rejects an invalid Redis URL without exposing its value: %s", (redisUrl) => {
    let thrown: unknown;
    try {
      parseEnvironment({ ...runtimeEnvironment, REDIS_URL: redisUrl });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApplicationError);
    expect((thrown as Error).message).toContain("REDIS_URL");
    expect((thrown as Error).message).not.toContain(redisUrl);
    expect(JSON.stringify(thrown)).not.toContain("sentinel-secret");
  });

  it("creates one structured deeply immutable configuration", () => {
    const created = createRuntimeConfig(parseEnvironment(runtimeEnvironment));

    expect(created).toEqual(config);
    expect(created.app).toMatchObject({
      environment: "test",
      port: "4000",
      clientUrl: "http://localhost:3000",
      serverUrl: "http://localhost:4000",
      frontendUrl: "https://nexuswebapp.vercel.app",
    });
    expect(created.auth.jwtSecret).toBe(runtimeEnvironment.JWT_SECRET);
    expect(created.redis).toEqual({ url: undefined });
    expect(created.oauth.callbackUrl).toBe(
      "http://localhost:4000/api/v1/auth/google/callback",
    );
    expect(Object.isFrozen(created)).toBe(true);
    for (const value of Object.values(created)) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });
});
