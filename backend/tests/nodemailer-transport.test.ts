import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: mocks.createTransport },
}));

describe("backend Nodemailer transport", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
  });

  it("does not create a transport when the provider module is imported", async () => {
    await import("../src/config/nodemailer.config.js");
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });

  it("creates the Gmail transport once with server-only credentials", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { configureNodemailer, getEmailTransporter } = await import(
      "../src/config/nodemailer.config.js"
    );
    const configuration = {
      sender: "sender@example.test",
      password: "obvious-test-app-password",
    };

    const first = configureNodemailer(configuration);
    const second = configureNodemailer(configuration);

    expect(mocks.createTransport).toHaveBeenCalledOnce();
    expect(mocks.createTransport).toHaveBeenCalledWith({
      service: "gmail",
      auth: {
        user: "sender@example.test",
        pass: "obvious-test-app-password",
      },
    });
    expect(first).toBe(second);
    expect(getEmailTransporter()).toBe(first);
    expect(consoleLog).not.toHaveBeenCalled();
    consoleLog.mockRestore();
  });

  it("sanitizes synchronous provider initialization failures", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.createTransport.mockImplementationOnce(() => {
      throw new Error("obvious-fake-provider-secret-detail");
    });
    const { configureNodemailer } = await import("../src/config/nodemailer.config.js");

    expect(() => configureNodemailer({
      sender: "sender@example.test",
      password: "obvious-fake-email-password",
    })).toThrow("Email provider initialization failed.");

    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).toContain("Email transporter initialization failed.");
    expect(logged).not.toContain("obvious-fake-provider-secret-detail");
    expect(logged).not.toContain("obvious-fake-email-password");
    errorLog.mockRestore();
  });
});
