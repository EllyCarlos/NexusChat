import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(async (_message: Record<string, unknown>) => undefined),
}));

vi.mock("../src/config/nodemailer.config.js", () => ({
  transporter: { sendMail: mocks.sendMail },
}));

vi.mock("../src/schemas/env.schema.js", () => ({
  env: {
    EMAIL: "sender@example.test",
    OTP_EXPIRATION_MINUTES: "5",
  },
}));

import { sendMail } from "../src/utils/email.util.js";

const getMessage = () => {
  expect(mocks.sendMail).toHaveBeenCalledTimes(1);
  return mocks.sendMail.mock.calls[0][0];
};

const expectSafeMessageShape = (message: Record<string, unknown>) => {
  expect(message).toMatchObject({ from: "sender@example.test", to: "user@example.test" });
  expect(message).not.toHaveProperty("raw");
  expect(message).not.toHaveProperty("attachments");
  expect(message).not.toHaveProperty("headers");
};

describe("backend test-email message construction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("constructs the OTP email", async () => {
    await sendMail("user@example.test", "Alice", "OTP", undefined, "123456");

    const message = getMessage();
    expectSafeMessageShape(message);
    expect(message.subject).toBe("Verify Your Email Address for NexusChat");
    expect(message.html).toEqual(expect.stringContaining("123456"));
  });

  it("constructs the password-reset email", async () => {
    const resetUrl = "https://nexus.example/auth/reset-password?token=reset-token";
    await sendMail("user@example.test", "Alice", "resetPassword", resetUrl);

    const message = getMessage();
    expectSafeMessageShape(message);
    expect(message.subject).toBe("Reset Your Password for NexusChat");
    expect(message.html).toEqual(expect.stringContaining(resetUrl));
  });

  it("constructs the private-key-recovery email", async () => {
    const verificationUrl = "https://nexus.example/auth/private-key-recovery?token=recovery-token";
    await sendMail("user@example.test", "Alice", "privateKeyRecovery", undefined, undefined, verificationUrl);

    const message = getMessage();
    expectSafeMessageShape(message);
    expect(message.subject).toBe("Action Required: Verify Your Request to Recover Private Key");
    expect(message.html).toEqual(expect.stringContaining(verificationUrl));
  });

  it("constructs the welcome email", async () => {
    await sendMail("user@example.test", "Alice", "welcome");

    const message = getMessage();
    expectSafeMessageShape(message);
    expect(message.subject).toEqual(expect.stringContaining("Welcome to NexusChat"));
    expect(message.html).toEqual(expect.stringContaining("Alice"));
  });
});
