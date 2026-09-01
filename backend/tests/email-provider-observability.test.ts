import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LoggerPort } from "../src/observability/logger.port.js";
import { createCapturingLogger } from "./support/capturing-logger.js";

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
}));

vi.mock("../src/config/env.config.js", () => ({
  config: { app: { frontendUrl: "https://web.example.test" } },
}));
vi.mock("../src/modules/users/profile.service.js", () => ({
  updateUserAvatar: vi.fn(),
}));
vi.mock("../src/utils/email.util.js", () => ({
  sendMail: mocks.sendMail,
}));
vi.mock("../src/modules/auth/token/session-token.service.js", () => ({
  signPasswordResetToken: vi.fn(() => "opaque-reset-token"),
}));
vi.mock("../src/utils/upload-lifecycle.util.js", () => ({
  cleanupTemporaryFiles: vi.fn(),
}));

import { testEmailHandler } from "../src/controllers/user.controller.js";

const createHarness = (logger: LoggerPort) => {
  const request = {
    query: { emailType: "welcome" },
    user: {
      id: "cm2e600000000000000000001",
      email: "private-recipient@example.test",
      username: "private-recipient",
    },
    app: { get: vi.fn(() => logger) },
  } as unknown as Request;
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response;
  vi.mocked(response.status).mockReturnValue(response);
  vi.mocked(response.json).mockReturnValue(response);
  const next = vi.fn() as unknown as NextFunction;

  return { request, response, next };
};

describe("email provider failure observability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendMail.mockResolvedValue(undefined);
  });

  it("keeps successful email delivery quiet", async () => {
    const logger = createCapturingLogger("application");
    const harness = createHarness(logger);

    await testEmailHandler(harness.request, harness.response, harness.next);

    expect(harness.response.status).toHaveBeenCalledWith(200);
    expect(logger.events).toEqual([]);
  });

  it("emits one bounded provider failure without recipient or provider details", async () => {
    const logger = createCapturingLogger("application");
    const sensitiveFailure = "smtp://private-user:private-password@example.test";
    mocks.sendMail.mockRejectedValueOnce(new Error(sensitiveFailure));
    const harness = createHarness(logger);

    await testEmailHandler(harness.request, harness.response, harness.next);

    expect(logger.events).toEqual([{
      level: "error",
      component: "notification",
      event: "notification.email_send.failed",
      fields: {
        provider: "email",
        operation: "email_send",
        errorCategory: "provider",
        result: "failed",
        durationMs: expect.any(Number),
        errorType: "Error",
      },
    }]);
    const serialized = JSON.stringify(logger.events);
    expect(serialized).not.toContain(sensitiveFailure);
    expect(serialized).not.toContain("private-recipient@example.test");
    expect(serialized).not.toContain("private-recipient");
    expect(harness.next).toHaveBeenCalledWith(expect.objectContaining({
      message: "Failed to send welcome email",
      statusCode: 500,
    }));
  });

  it("preserves the public email failure when the logger throws", async () => {
    const throwFromLogger = () => {
      throw new Error("logger unavailable");
    };
    const throwingLogger: LoggerPort = {
      component: "application",
      forComponent: () => throwingLogger,
      debug: throwFromLogger,
      info: throwFromLogger,
      warn: throwFromLogger,
      error: throwFromLogger,
    };
    mocks.sendMail.mockRejectedValueOnce(new Error("private SMTP failure"));
    const harness = createHarness(throwingLogger);

    await expect(
      testEmailHandler(harness.request, harness.response, harness.next),
    ).resolves.toBeUndefined();

    expect(harness.next).toHaveBeenCalledWith(expect.objectContaining({
      message: "Failed to send welcome email",
      statusCode: 500,
    }));
  });
});
