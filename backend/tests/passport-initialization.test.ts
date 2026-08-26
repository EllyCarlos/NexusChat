import type { RuntimeConfig } from "../src/interfaces/config/config.interface.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn() } },
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
  });

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
});
