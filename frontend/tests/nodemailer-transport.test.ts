import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: mocks.createTransport },
}));

describe("frontend Nodemailer transport", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
  });

  it("creates the Gmail transport with runtime-only credentials", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("EMAIL", "sender@example.test");
    vi.stubEnv("PASSWORD", "test-app-password");

    const { getTransporter } = await import("@/lib/server/nodemailer");
    expect(getTransporter()).toEqual({ sendMail: mocks.sendMail });
    expect(mocks.createTransport).toHaveBeenCalledWith({
      service: "gmail",
      auth: {
        user: "sender@example.test",
        pass: "test-app-password",
      },
    });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("fails clearly at flow execution when credentials are missing", async () => {
    vi.stubEnv("EMAIL", "");
    vi.stubEnv("PASSWORD", "");

    const { getTransporter } = await import("@/lib/server/nodemailer");
    expect(() => getTransporter()).toThrow("EMAIL and PASSWORD are required to send email");
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });
});
