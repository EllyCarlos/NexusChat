import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cert: vi.fn(),
  getApps: vi.fn(),
  getMessaging: vi.fn(),
  initializeApp: vi.fn(),
  messaging: { send: vi.fn() },
}));

vi.mock("firebase-admin/app", () => ({
  cert: mocks.cert,
  getApps: mocks.getApps,
  initializeApp: mocks.initializeApp,
}));

vi.mock("firebase-admin/messaging", () => ({
  getMessaging: mocks.getMessaging,
}));

vi.mock("../src/schemas/env.schema.js", () => ({
  env: { NODE_ENV: "production" },
}));

describe("Firebase Admin initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.FIREBASE_PROJECT_ID = "nexuschat-test";
    process.env.FIREBASE_CLIENT_EMAIL = "firebase-admin@example.test";
    process.env.FIREBASE_PRIVATE_KEY = "line-one\\nline-two";
    mocks.getApps.mockReturnValue([]);
    mocks.cert.mockReturnValue({ kind: "credential" });
    mocks.getMessaging.mockReturnValue(mocks.messaging);
  });

  it("initializes the default app through the existing production credential path", async () => {
    const { messaging } = await import("../src/config/firebase.config.js");

    expect(mocks.cert).toHaveBeenCalledWith({
      projectId: "nexuschat-test",
      clientEmail: "firebase-admin@example.test",
      privateKey: "line-one\nline-two",
    });
    expect(mocks.initializeApp).toHaveBeenCalledWith({
      credential: { kind: "credential" },
    });
    expect(mocks.getMessaging).toHaveBeenCalledOnce();
    expect(messaging).toBe(mocks.messaging);
  });

  it("reuses an existing default app", async () => {
    mocks.getApps.mockReturnValue([{ name: "[DEFAULT]" }]);

    await import("../src/config/firebase.config.js");

    expect(mocks.cert).not.toHaveBeenCalled();
    expect(mocks.initializeApp).not.toHaveBeenCalled();
    expect(mocks.getMessaging).toHaveBeenCalledOnce();
  });
});
