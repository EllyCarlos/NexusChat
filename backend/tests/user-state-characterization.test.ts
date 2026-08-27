import type { NextFunction, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userUpdate: vi.fn(),
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: { user: { update: mocks.userUpdate } },
}));

vi.mock("../src/config/env.config.js", () => ({
  config: {
    app: {
      clientUrl: "https://client.example.test",
      environment: "test",
      cookieDomain: undefined,
    },
  },
}));

vi.mock("../src/modules/auth/token/session-token.service.js", () => ({
  signOAuthExchangeToken: vi.fn(),
}));

import {
  checkAuth,
  completeKeyRecovery,
  getUserInfo,
  updateFcmToken,
} from "../src/controllers/auth.controller.js";
import type { AuthenticatedRequest } from "../src/interfaces/auth/auth.interface.js";
import { errorMiddleware } from "../src/middlewares/error.middleware.js";

const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");
const UPDATED_AT = new Date("2026-01-02T00:00:00.000Z");
const CURRENT_USER = {
  id: "trusted-user-id",
  name: "Trusted User",
  username: "trusted-user",
  avatar: "https://example.test/avatar.png",
  email: "trusted@example.test",
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  emailVerified: true,
  publicKey: "public-key",
  needsKeyRecovery: true,
  keyRecoveryCompletedAt: null,
  notificationsEnabled: false,
  verificationBadge: true,
  fcmToken: null,
  oAuthSignup: false,
  avatarCloudinaryPublicId: "must-not-be-returned",
} satisfies AuthenticatedRequest["user"];

const CURRENT_USER_RESPONSE = {
  id: CURRENT_USER.id,
  name: CURRENT_USER.name,
  username: CURRENT_USER.username,
  avatar: CURRENT_USER.avatar,
  email: CURRENT_USER.email,
  createdAt: CURRENT_USER.createdAt,
  updatedAt: CURRENT_USER.updatedAt,
  emailVerified: CURRENT_USER.emailVerified,
  publicKey: CURRENT_USER.publicKey,
  needsKeyRecovery: CURRENT_USER.needsKeyRecovery,
  keyRecoveryCompletedAt: CURRENT_USER.keyRecoveryCompletedAt,
  notificationsEnabled: CURRENT_USER.notificationsEnabled,
  verificationBadge: CURRENT_USER.verificationBadge,
  fcmToken: CURRENT_USER.fcmToken,
  oAuthSignup: CURRENT_USER.oAuthSignup,
};

const responseMock = () => {
  const response = {
    clearCookie: vi.fn(),
    json: vi.fn(),
    redirect: vi.fn(),
    status: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response;
};

const authenticatedRequest = (
  overrides: Partial<AuthenticatedRequest> = {},
): AuthenticatedRequest => ({
  body: {},
  user: CURRENT_USER,
  ...overrides,
} as AuthenticatedRequest);

describe("current-user and user-state controller characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["user endpoint", getUserInfo],
    ["token check", checkAuth],
  ])("returns the exact safe projection for the %s", async (_label, handler) => {
    const response = responseMock();
    const next = vi.fn();

    await handler(authenticatedRequest(), response, next as NextFunction);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(CURRENT_USER_RESPONSE);
    expect(response.json).not.toHaveBeenCalledWith(expect.objectContaining({
      avatarCloudinaryPublicId: expect.anything(),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it("preserves the distinct missing-context errors", async () => {
    const missingUserNext = vi.fn();
    const missingTokenNext = vi.fn();
    const request = authenticatedRequest({ user: undefined as never });

    await getUserInfo(request, responseMock(), missingUserNext as NextFunction);
    await checkAuth(request, responseMock(), missingTokenNext as NextFunction);

    expect(missingUserNext).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 404,
      message: "User not found in request context",
    }));
    expect(missingTokenNext).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 401,
      message: "Token missing, please login again",
    }));
  });

  it("updates only the authenticated user's FCM token and preserves the response", async () => {
    mocks.userUpdate.mockResolvedValueOnce({ fcmToken: "opaque-registration-token" });
    const response = responseMock();
    const next = vi.fn();

    await updateFcmToken(authenticatedRequest({
      body: {
        fcmToken: "opaque-registration-token",
        userId: "body-controlled-user-id",
        notificationsEnabled: true,
      },
    }), response, next as NextFunction);

    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: CURRENT_USER.id },
      data: { fcmToken: "opaque-registration-token" },
    }));
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ fcmToken: "opaque-registration-token" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an empty FCM token but preserves whitespace-token acceptance", async () => {
    const emptyNext = vi.fn();
    await updateFcmToken(
      authenticatedRequest({ body: { fcmToken: "" } }),
      responseMock(),
      emptyNext as NextFunction,
    );
    expect(emptyNext).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400,
      message: "FCM token is required",
    }));
    expect(mocks.userUpdate).not.toHaveBeenCalled();

    mocks.userUpdate.mockResolvedValueOnce({ fcmToken: "   " });
    const whitespaceResponse = responseMock();
    const whitespaceNext = vi.fn();
    await updateFcmToken(
      authenticatedRequest({ body: { fcmToken: "   " } }),
      whitespaceResponse,
      whitespaceNext as NextFunction,
    );
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { fcmToken: "   " },
    }));
    expect(whitespaceResponse.json).toHaveBeenCalledWith({ fcmToken: "   " });
    expect(whitespaceNext).not.toHaveBeenCalled();
  });

  it("preserves the generic public error when FCM persistence fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.userUpdate.mockRejectedValueOnce(new Error("private FCM database detail"));
    const controllerNext = vi.fn();

    await updateFcmToken(
      authenticatedRequest({ body: { fcmToken: "opaque-registration-token" } }),
      responseMock(),
      controllerNext as NextFunction,
    );

    const publicResponse = responseMock();
    errorMiddleware(
      controllerNext.mock.calls[0]?.[0],
      { is: vi.fn(() => false) } as never,
      publicResponse,
      vi.fn(),
    );

    expect(publicResponse.status).toHaveBeenCalledWith(500);
    expect(publicResponse.json).toHaveBeenCalledWith({
      success: false,
      message: "Internal server error",
    });
    expect(JSON.stringify(
      (publicResponse.json as ReturnType<typeof vi.fn>).mock.calls,
    )).not.toContain("private FCM database detail");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("private FCM database detail");
    errorLog.mockRestore();
  });

  it("persists the recovery state for the authenticated user with the existing response", async () => {
    const successLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.userUpdate.mockImplementationOnce(async ({ data }) => ({
      id: CURRENT_USER.id,
      needsKeyRecovery: data.needsKeyRecovery,
      keyRecoveryCompletedAt: data.keyRecoveryCompletedAt,
    }));
    const response = responseMock();
    const next = vi.fn();

    await completeKeyRecovery(authenticatedRequest(), response, next as NextFunction);

    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: CURRENT_USER.id },
      data: {
        needsKeyRecovery: false,
        keyRecoveryCompletedAt: expect.any(Date),
      },
      select: {
        id: true,
        needsKeyRecovery: true,
        keyRecoveryCompletedAt: true,
      },
    });
    const completedAt = mocks.userUpdate.mock.calls[0]?.[0].data.keyRecoveryCompletedAt;
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      message: "Private key recovery status updated successfully.",
      user: {
        id: CURRENT_USER.id,
        needsKeyRecovery: false,
        keyRecoveryCompletedAt: completedAt,
      },
    });
    expect(next).not.toHaveBeenCalled();
    successLog.mockRestore();
  });

  it("sanitizes recovery persistence failures", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.userUpdate.mockRejectedValueOnce(new Error("private recovery database detail"));
    const next = vi.fn();

    await completeKeyRecovery(authenticatedRequest(), responseMock(), next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 500,
      message: "Failed to complete private key recovery.",
    }));
    expect(JSON.stringify(next.mock.calls)).not.toContain("private recovery database detail");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("private recovery database detail");
    errorLog.mockRestore();
  });
});
