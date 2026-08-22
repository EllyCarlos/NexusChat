import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: mocks.createTransport },
}));

vi.mock("../src/schemas/env.schema.js", () => ({
  env: {
    EMAIL: "sender@example.test",
    PASSWORD: "test-app-password",
  },
}));

describe("backend Nodemailer transport", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
  });

  it("creates the Gmail transport with server-only credentials", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const { transporter } = await import("../src/config/nodemailer.config.js");
    expect(transporter).toEqual({ sendMail: mocks.sendMail });
    expect(mocks.createTransport).toHaveBeenCalledWith({
      service: "gmail",
      auth: {
        user: "sender@example.test",
        pass: "test-app-password",
      },
    });
    expect(consoleLog).not.toHaveBeenCalled();
    consoleLog.mockRestore();
  });
});
