import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(async (_message: Record<string, unknown>): Promise<unknown> => undefined),
}));

vi.mock("../src/config/nodemailer.config.js", () => ({
  getEmailTransporter: () => ({ sendMail: mocks.sendMail }),
}));

vi.mock("../src/config/env.config.js", () => ({
  config: {
    auth: { otpExpirationMinutes: "5" },
    email: { sender: "sender@example.test" },
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
    expect(message.html).toEqual(expect.stringContaining("<h1>Verify Your NexusChat Account</h1>"));
    expect(message.html).toEqual(expect.stringContaining("<p>Hi Alice,</p>"));
    expect(message.html).toEqual(expect.stringContaining("<p class='otp'>123456</p>"));
    expect(message.html).toEqual(expect.stringContaining("This code is valid for 5 minutes."));
  });

  it("constructs the password-reset email", async () => {
    const resetUrl = "https://nexus.example/auth/reset-password?token=reset-token";
    await sendMail("user@example.test", "Alice", "resetPassword", resetUrl);

    const message = getMessage();
    expectSafeMessageShape(message);
    expect(message.subject).toBe("Reset Your Password for NexusChat");
    expect(message.html).toEqual(expect.stringContaining("<h1>Reset Your NexusChat Password</h1>"));
    expect(message.html).toEqual(expect.stringContaining("<p>Hi Alice,</p>"));
    expect(message.html).toEqual(expect.stringContaining(resetUrl));
    expect(message.html).toEqual(expect.stringContaining("This link will expire in 24 hours."));
  });

  it("constructs the private-key-recovery email", async () => {
    const verificationUrl = "https://nexus.example/auth/private-key-recovery?token=recovery-token";
    await sendMail("user@example.test", "Alice", "privateKeyRecovery", undefined, undefined, verificationUrl);

    const message = getMessage();
    expectSafeMessageShape(message);
    expect(message.subject).toBe("Action Required: Verify Your Request to Recover Private Key");
    expect(message.html).toEqual(expect.stringContaining("<h1>Verify Private Key Recovery</h1>"));
    expect(message.html).toEqual(expect.stringContaining("<p>Hello Alice,</p>"));
    expect(message.html).toEqual(expect.stringContaining(verificationUrl));
    expect(message.html).toEqual(expect.stringContaining("this link will expire in 5 minutes."));
  });

  it("constructs the welcome email", async () => {
    await sendMail("user@example.test", "Alice", "welcome");

    const message = getMessage();
    expectSafeMessageShape(message);
    expect(message.subject).toBe("Welcome to NexusChat! Get Started Today 🚀");
    expect(message.html).toEqual(expect.stringContaining("<h1>Welcome to NexusChat!</h1>"));
    expect(message.html).toEqual(expect.stringContaining("<p>Hello Alice,</p>"));
    expect(message.html).toEqual(expect.stringContaining("Welcome to NexusChat! We're excited to have you on board."));
  });

  it("waits for the transporter and suppresses its provider response", async () => {
    let resolveDelivery!: (value: unknown) => void;
    const providerDelivery = new Promise<unknown>((resolve) => {
      resolveDelivery = resolve;
    });
    mocks.sendMail.mockReturnValueOnce(providerDelivery);

    const delivery = sendMail("user@example.test", "Alice", "welcome");
    let settled = false;
    void delivery.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    resolveDelivery({ messageId: "provider-response" });
    await expect(delivery).resolves.toBeUndefined();
    expect(settled).toBe(true);
  });

  it("propagates transporter rejection", async () => {
    const providerError = new Error("provider rejected the message");
    mocks.sendMail.mockRejectedValueOnce(providerError);

    await expect(
      sendMail("user@example.test", "Alice", "OTP", undefined, "123456"),
    ).rejects.toBe(providerError);
  });

  it("rejects an unsupported runtime email type before calling the transporter", async () => {
    await expect(
      sendMail("user@example.test", "Alice", "unsupported" as never),
    ).rejects.toThrow("Unsupported email type: unsupported");

    expect(mocks.sendMail).not.toHaveBeenCalled();
  });
});
