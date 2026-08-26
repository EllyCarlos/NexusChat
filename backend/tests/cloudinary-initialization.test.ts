import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configure: vi.fn(),
}));

vi.mock("cloudinary", () => ({
  v2: { config: mocks.configure },
}));

describe("Cloudinary initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("does not configure the client when the provider module is imported", async () => {
    await import("../src/config/cloudinary.config.js");
    expect(mocks.configure).not.toHaveBeenCalled();
  });

  it("configures the client once", async () => {
    const { configureCloudinary } = await import("../src/config/cloudinary.config.js");
    const configuration = {
      cloudName: "obvious-fake-cloud",
      apiKey: "obvious-fake-api-key",
      apiSecret: "obvious-fake-api-secret",
    };

    configureCloudinary(configuration);
    configureCloudinary(configuration);

    expect(mocks.configure).toHaveBeenCalledOnce();
    expect(mocks.configure).toHaveBeenCalledWith({
      cloud_name: configuration.cloudName,
      api_key: configuration.apiKey,
      api_secret: configuration.apiSecret,
    });
  });
});
