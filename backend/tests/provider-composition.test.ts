import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configureCloudinary: vi.fn(),
  configureNodemailer: vi.fn(),
  initializeFirebaseAdmin: vi.fn(),
  registerGoogleStrategy: vi.fn(),
}));

vi.mock("../src/config/cloudinary.config.js", () => ({
  configureCloudinary: mocks.configureCloudinary,
}));
vi.mock("../src/config/firebase.config.js", () => ({
  initializeFirebaseAdmin: mocks.initializeFirebaseAdmin,
}));
vi.mock("../src/config/nodemailer.config.js", () => ({
  configureNodemailer: mocks.configureNodemailer,
}));
vi.mock("../src/passport/google.strategy.js", () => ({
  registerGoogleStrategy: mocks.registerGoogleStrategy,
}));

import type { RuntimeConfig } from "../src/interfaces/config/config.interface.js";
import { initializeProviders } from "../src/config/providers.config.js";

describe("provider composition", () => {
  it("configures every provider exactly once", () => {
    const configuration = {
      cloudinary: { cloudName: "cloud", apiKey: "key", apiSecret: "secret" },
      email: { sender: "sender@example.test", password: "password" },
    } as RuntimeConfig;

    initializeProviders(configuration);
    initializeProviders(configuration);

    expect(mocks.configureCloudinary).toHaveBeenCalledOnce();
    expect(mocks.configureCloudinary).toHaveBeenCalledWith(configuration.cloudinary);
    expect(mocks.initializeFirebaseAdmin).toHaveBeenCalledOnce();
    expect(mocks.initializeFirebaseAdmin).toHaveBeenCalledWith(
      configuration,
      expect.objectContaining({ component: "provider" }),
    );
    expect(mocks.configureNodemailer).toHaveBeenCalledOnce();
    expect(mocks.configureNodemailer).toHaveBeenCalledWith(
      configuration.email,
      expect.objectContaining({ component: "provider" }),
    );
    expect(mocks.registerGoogleStrategy).toHaveBeenCalledOnce();
    expect(mocks.registerGoogleStrategy).toHaveBeenCalledWith(
      configuration,
      expect.objectContaining({ component: "auth" }),
    );
  });
});
