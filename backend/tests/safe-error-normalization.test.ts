import { describe, expect, it } from "vitest";

import {
  ApplicationError,
  CustomError,
} from "../src/errors/application-error.js";
import { getSafeErrorMetadata } from "../src/observability/safe-error.js";

const SENSITIVE_TOKEN = "private-provider-token";
const SENSITIVE_URL = "rediss://user:password@private.example.test:6379";

const serialized = (error: unknown): string =>
  JSON.stringify(getSafeErrorMetadata(error));

describe("safe structured error normalization", () => {
  it("normalizes an ordinary Error without its message or stack", () => {
    const error = new Error(`${SENSITIVE_TOKEN} ${SENSITIVE_URL}`);
    error.stack = `Error: ${SENSITIVE_TOKEN}\n at C:\\private\\source.ts:1:1`;

    expect(getSafeErrorMetadata(error)).toEqual({ errorType: "Error" });
    expect(serialized(error)).not.toContain(SENSITIVE_TOKEN);
    expect(serialized(error)).not.toContain("private\\source.ts");
  });

  it("retains only the bounded ApplicationError type and code", () => {
    const error = new ApplicationError({
      code: "PROVIDER_UNAVAILABLE",
      message: `${SENSITIVE_TOKEN} ${SENSITIVE_URL}`,
      statusCode: 500,
    });

    expect(getSafeErrorMetadata(error)).toEqual({
      errorType: "ApplicationError",
      applicationCode: "PROVIDER_UNAVAILABLE",
    });
    expect(serialized(error)).not.toContain(SENSITIVE_TOKEN);
    expect(serialized(error)).not.toContain(SENSITIVE_URL);
  });

  it("preserves the legacy CustomError normalization and application code", () => {
    const error = new CustomError(SENSITIVE_TOKEN, 500);

    expect(getSafeErrorMetadata(error)).toEqual({
      errorType: "CustomError",
      applicationCode: "LEGACY_CUSTOM_ERROR",
    });
  });

  it.each([
    ["unknown object", { message: SENSITIVE_TOKEN, url: SENSITIVE_URL }],
    ["thrown string", SENSITIVE_TOKEN],
    ["null", null],
  ])("normalizes an %s as UnknownError", (_label, value) => {
    expect(getSafeErrorMetadata(value)).toEqual({ errorType: "UnknownError" });
    expect(serialized(value)).not.toContain(SENSITIVE_TOKEN);
    expect(serialized(value)).not.toContain(SENSITIVE_URL);
  });

  it("collapses an unapproved custom Error name to Error", () => {
    const error = new Error(SENSITIVE_TOKEN);
    error.name = "ProviderSecretError";

    expect(getSafeErrorMetadata(error)).toEqual({ errorType: "Error" });
    expect(serialized(error)).not.toContain("ProviderSecretError");
  });

  it("retains an approved Prisma-like error name without raw provider data", () => {
    const error = new Error(`${SENSITIVE_URL} ${SENSITIVE_TOKEN}`) as Error & {
      query?: string;
      token?: string;
    };
    error.name = "PrismaClientKnownRequestError";
    error.query = `SELECT '${SENSITIVE_TOKEN}'`;
    error.token = SENSITIVE_TOKEN;

    expect(getSafeErrorMetadata(error)).toEqual({
      errorType: "PrismaClientKnownRequestError",
    });
    const output = serialized(error);
    expect(output).not.toContain(SENSITIVE_TOKEN);
    expect(output).not.toContain(SENSITIVE_URL);
    expect(output).not.toContain("SELECT");
  });

  it("omits secret-looking properties attached to an Error", () => {
    const error = Object.assign(new Error("provider failure"), {
      token: SENSITIVE_TOKEN,
      credentials: SENSITIVE_URL,
      response: { body: SENSITIVE_TOKEN },
    });

    const output = serialized(error);
    expect(output).toBe('{"errorType":"Error"}');
    expect(output).not.toContain(SENSITIVE_TOKEN);
    expect(output).not.toContain(SENSITIVE_URL);
  });
});
