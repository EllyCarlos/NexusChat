import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCapturingLogger } from "./support/capturing-logger.js";

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

  it("rejects access before the email provider is configured", async () => {
    const { getEmailTransporter } = await import("../src/config/nodemailer.config.js");

    let thrown: unknown;
    try {
      getEmailTransporter();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "EMAIL_PROVIDER_NOT_INITIALIZED",
      message: "Email provider is not initialized.",
      statusCode: 500,
    });
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
    mocks.createTransport.mockImplementationOnce(() => {
      throw new Error("obvious-fake-provider-secret-detail");
    });
    const { configureNodemailer } = await import("../src/config/nodemailer.config.js");
    const logger = createCapturingLogger("provider");

    expect(() => configureNodemailer({
      sender: "sender@example.test",
      password: "obvious-fake-email-password",
    }, logger)).toThrow("Email provider initialization failed.");

    expect(logger.events).toEqual([{
      level: "error",
      component: "provider",
      event: "provider.email_initialization.failed",
      fields: { errorType: "Error" },
    }]);
    const logged = JSON.stringify(logger.events);
    expect(logged).not.toContain("obvious-fake-provider-secret-detail");
    expect(logged).not.toContain("obvious-fake-email-password");
  });
});
