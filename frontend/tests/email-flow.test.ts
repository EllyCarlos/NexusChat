import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sendMail = vi.fn(async (_message: Record<string, unknown>) => undefined);
  return {
    sendMail,
    getTransporter: vi.fn(() => ({ sendMail })),
  };
});

vi.mock("@/lib/server/nodemailer", () => ({
  getTransporter: mocks.getTransporter,
}));

import { sendEmail } from "@/lib/server/email/SendEmail";

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

describe("frontend email message construction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EMAIL = "sender@example.test";
  });

  it("constructs the OTP email", async () => {
    await sendEmail({
      emailType: "OTP",
      to: "user@example.test",
      username: "Alice",
      otp: "123456",
    });

    const message = getMessage();
    expectSafeMessageShape(message);
    expect(message.subject).toBe("Verify Your Email Address for NexusChat");
    expect(message.html).toEqual(expect.stringContaining("123456"));
  });

  it("constructs the password-reset email with its reset URL", async () => {
    const resetUrl = "https://nexus.example/auth/reset-password?token=reset-token";

    await sendEmail({
      emailType: "resetPassword",
      to: "user@example.test",
      username: "Alice",
      resetPasswordUrl: resetUrl,
    });

    const message = getMessage();
    expectSafeMessageShape(message);
    expect(message.subject).toBe("Reset Your Password for NexusChat");
    expect(message.html).toEqual(expect.stringContaining(resetUrl));
  });

  it("constructs the private-key-recovery email", async () => {
    const verificationUrl = "https://nexus.example/auth/private-key-recovery?token=recovery-token";

    await sendEmail({
      emailType: "privateKeyRecovery",
      to: "user@example.test",
      username: "Alice",
      verificationUrl,
    });

    const message = getMessage();
    expectSafeMessageShape(message);
    expect(message.subject).toBe("Action Required: Verify Your Request to Recover Private Key");
    expect(message.html).toEqual(expect.stringContaining(verificationUrl));
  });

  it("constructs the available welcome email", async () => {
    await sendEmail({
      emailType: "welcome",
      to: "user@example.test",
      username: "Alice",
    });

    const message = getMessage();
    expectSafeMessageShape(message);
    expect(message.subject).toEqual(expect.stringContaining("Welcome to NexusChat"));
    expect(message.html).toEqual(expect.stringContaining("Alice"));
  });
});
