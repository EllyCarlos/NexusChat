import type { RuntimeConfig } from "../src/interfaces/config/config.interface.js";
import type { LoggerPort } from "../src/observability/logger.port.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCapturingLogger } from "./support/capturing-logger.js";

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(),
  findUser: vi.fn(),
  hash: vi.fn(),
  strategy: vi.fn(function StrategyMock(this: object) {
    return this;
  }),
  use: vi.fn(),
}));

vi.mock("passport", () => ({
  default: { use: mocks.use },
}));
vi.mock("passport-google-oauth20", () => ({
  Strategy: mocks.strategy,
}));
vi.mock("bcryptjs", () => ({
  default: { hash: mocks.hash },
}));
vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: { user: { findUnique: mocks.findUser, create: mocks.createUser } },
}));

const configuration = {
  oauth: {
    googleClientId: "obvious-fake-google-client",
    googleClientSecret: "obvious-fake-google-secret",
    callbackUrl: "https://api.example.test/api/v1/auth/google/callback",
  },
} as Pick<RuntimeConfig, "oauth">;

describe("Google strategy initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.hash.mockResolvedValue("obvious-fake-password-hash");
  });

  const registerAndGetVerifier = async (logger = createCapturingLogger("auth")) => {
    const { registerGoogleStrategy } = await import("../src/passport/google.strategy.js");
    registerGoogleStrategy(configuration, logger);
    return mocks.strategy.mock.calls[0]?.[1] as (
      accessToken: string,
      refreshToken: string,
      profile: Record<string, unknown>,
      done: ReturnType<typeof vi.fn>,
    ) => Promise<void>;
  };

  it("does not register a strategy when the module is imported", async () => {
    await import("../src/passport/google.strategy.js");
    expect(mocks.strategy).not.toHaveBeenCalled();
    expect(mocks.use).not.toHaveBeenCalled();
  });

  it("registers the existing Google strategy exactly once", async () => {
    const { registerGoogleStrategy } = await import("../src/passport/google.strategy.js");

    registerGoogleStrategy(configuration);
    registerGoogleStrategy(configuration);

    expect(mocks.strategy).toHaveBeenCalledOnce();
    expect(mocks.strategy).toHaveBeenCalledWith(
      {
        clientID: configuration.oauth.googleClientId,
        clientSecret: configuration.oauth.googleClientSecret,
        callbackURL: configuration.oauth.callbackUrl,
      },
      expect.any(Function),
    );
    expect(mocks.use).toHaveBeenCalledOnce();
  });

  it("returns the existing account through the current safe OAuth projection", async () => {
    const existingUser = {
      id: "existing-user",
      username: "existing",
      name: "Existing User",
      avatar: "https://example.test/existing.png",
      email: "existing@example.test",
      emailVerified: true,
    };
    mocks.findUser.mockResolvedValueOnce(existingUser);
    const verify = await registerAndGetVerifier();
    const done = vi.fn();

    await verify("ignored-access", "ignored-refresh", {
      id: "google-existing",
      displayName: "Provider Name",
      emails: [{ value: existingUser.email }],
    }, done);

    expect(mocks.findUser).toHaveBeenCalledWith({
      where: { email: existingUser.email },
      select: {
        id: true,
        username: true,
        name: true,
        avatar: true,
        email: true,
        emailVerified: true,
      },
    });
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith(null, {
      id: existingUser.id,
      username: existingUser.username,
      name: existingUser.name,
      avatar: existingUser.avatar,
      email: existingUser.email,
      emailVerified: existingUser.emailVerified,
      newUser: false,
      googleId: "google-existing",
    });
    expect(done.mock.calls[0]?.[1]).not.toHaveProperty("hashedPassword");
    expect(done.mock.calls[0]?.[1]).not.toHaveProperty("privateKey");
  });

  it("creates a new Google account with the current defaults and exact projection", async () => {
    mocks.findUser.mockResolvedValueOnce(null);
    const createdUser = {
      id: "new-user",
      username: "New User",
      name: "New",
      avatar: "https://example.test/provider.png",
      email: "new@example.test",
      emailVerified: true,
      googleId: "google-new",
    };
    mocks.createUser.mockResolvedValueOnce(createdUser);
    const verify = await registerAndGetVerifier();
    const done = vi.fn();

    await verify("ignored-access", "ignored-refresh", {
      id: "google-new",
      displayName: "New User",
      name: { givenName: "New" },
      emails: [{ value: "new@example.test" }],
      photos: [{ value: "https://example.test/provider.png" }],
    }, done);

    expect(mocks.hash).toHaveBeenCalledWith("google-new", 10);
    expect(mocks.createUser).toHaveBeenCalledWith({
      data: {
        username: "New User",
        name: "New",
        avatar: "https://example.test/provider.png",
        email: "new@example.test",
        hashedPassword: "obvious-fake-password-hash",
        emailVerified: true,
        oAuthSignup: true,
        googleId: "google-new",
      },
      select: {
        id: true,
        username: true,
        name: true,
        avatar: true,
        email: true,
        emailVerified: true,
        googleId: true,
      },
    });
    expect(done).toHaveBeenCalledWith(null, { ...createdUser, newUser: true });
  });

  it("uses the existing default avatar when Google has no profile photo", async () => {
    mocks.findUser.mockResolvedValueOnce(null);
    mocks.createUser.mockResolvedValueOnce({
      id: "default-avatar-user",
      username: "No Photo",
      name: "No",
      avatar: "created-avatar",
      email: "no-photo@example.test",
      emailVerified: true,
      googleId: "google-no-photo",
    });
    const verify = await registerAndGetVerifier();

    await verify("ignored-access", "ignored-refresh", {
      id: "google-no-photo",
      displayName: "No Photo",
      name: { givenName: "No" },
      emails: [{ value: "no-photo@example.test" }],
    }, vi.fn());

    expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        avatar: "https://res.cloudinary.com/dh5fjdce9/image/upload/v1717842288/defaultAvatar_q2y2az.png",
      }),
    }));
  });

  it.each([
    ["lookup", () => mocks.findUser.mockRejectedValueOnce(new Error("private lookup detail"))],
    ["hash", () => {
      mocks.findUser.mockResolvedValueOnce(null);
      mocks.hash.mockRejectedValueOnce(new Error("private hash detail"));
    }],
    ["create", () => {
      mocks.findUser.mockResolvedValueOnce(null);
      mocks.createUser.mockRejectedValueOnce(new Error("private create detail"));
    }],
  ])("normalizes %s failures to the existing Passport callback", async (_label, arrange) => {
    arrange();
    const logger = createCapturingLogger("auth");
    const verify = await registerAndGetVerifier(logger);
    const done = vi.fn();

    await verify("ignored-access", "ignored-refresh", {
      id: "google-failure",
      displayName: "Failure User",
      name: { givenName: "Failure" },
      emails: [{ value: "failure@example.test" }],
    }, done);

    expect(done).toHaveBeenCalledWith(null, false);
    expect(logger.events).toEqual([{
      level: "error",
      component: "auth",
      event: "auth.oauth_profile.failed",
      fields: {
        errorType: "ApplicationError",
        applicationCode: "GOOGLE_ACCOUNT_PROVISIONING_FAILED",
        provider: "google_oauth",
        operation: "profile_provision",
        errorCategory: "provider",
        result: "failed",
        durationMs: expect.any(Number),
      },
    }]);
  });

  it("preserves the Passport failure callback when the provider logger throws", async () => {
    mocks.findUser.mockRejectedValueOnce(new Error("private lookup detail"));
    const throwFromLogger = () => {
      throw new Error("logger unavailable");
    };
    const throwingLogger: LoggerPort = {
      component: "auth",
      forComponent: () => throwingLogger,
      debug: throwFromLogger,
      info: throwFromLogger,
      warn: throwFromLogger,
      error: throwFromLogger,
    };
    const verify = await registerAndGetVerifier(throwingLogger);
    const done = vi.fn();

    await expect(verify("ignored-access", "ignored-refresh", {
      id: "google-failure",
      displayName: "Failure User",
      name: { givenName: "Failure" },
      emails: [{ value: "failure@example.test" }],
    }, done)).resolves.toBeUndefined();

    expect(done).toHaveBeenCalledWith(null, false);
  });
});
