import { describe, expect, it, vi } from "vitest";
import { logServerError } from "../src/utils/safe-logger.utils.js";

const sensitiveValues = [
  "session.jwt.secret",
  "oauth.exchange.secret",
  "google-authorization-code",
  "signed-oauth-state",
  "full-fcm-registration-token",
  "password-reset-token",
  "private-key-recovery-token",
];

describe("safe server logging", () => {
  it("does not serialize error messages, stacks, or secret-bearing properties", () => {
    const error = new Error(sensitiveValues.join(" ")) as Error & Record<string, string>;
    error.stack = `Error: ${sensitiveValues.join(" ")}\n at C:\\private\\source.ts:1:1`;
    error.code = sensitiveValues.join("");
    error.token = sensitiveValues[0];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logServerError("Provider operation failed.", error);

    const output = JSON.stringify(errorSpy.mock.calls);
    expect(output).toContain("Provider operation failed.");
    expect(output).toContain("errorType");
    for (const value of sensitiveValues) {
      expect(output).not.toContain(value);
    }
    expect(output).not.toContain("private\\\\source.ts");
  });

  it("does not serialize unknown thrown payloads", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logServerError("Unknown failure.", { token: sensitiveValues[0], payload: sensitiveValues });

    const output = JSON.stringify(errorSpy.mock.calls);
    expect(output).toContain("UnknownError");
    for (const value of sensitiveValues) {
      expect(output).not.toContain(value);
    }
  });
});
