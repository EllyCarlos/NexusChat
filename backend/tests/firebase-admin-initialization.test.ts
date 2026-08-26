import type { RuntimeConfig } from "../src/interfaces/config/config.interface.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cert: vi.fn(),
  existingApp: { name: "[DEFAULT]" },
  getApp: vi.fn(),
  getApps: vi.fn(),
  getMessaging: vi.fn(),
  initializeApp: vi.fn(),
  initializedApp: { name: "initialized" },
  messaging: { send: vi.fn() },
}));

vi.mock("firebase-admin/app", () => ({
  cert: mocks.cert,
  getApp: mocks.getApp,
  getApps: mocks.getApps,
  initializeApp: mocks.initializeApp,
}));

vi.mock("firebase-admin/messaging", () => ({
  getMessaging: mocks.getMessaging,
}));

const productionConfig = {
  app: { environment: "production" },
  firebase: {
    projectId: "obvious-test-project",
    clientEmail: "firebase-admin@example.test",
    privateKey: "obvious-test-line-one\\nobvious-test-line-two",
    applicationCredentialsPath: "unused-in-production.json",
  },
} as Pick<RuntimeConfig, "app" | "firebase">;

describe("Firebase Admin initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getApps.mockReturnValue([]);
    mocks.getApp.mockReturnValue(mocks.existingApp);
    mocks.cert.mockReturnValue({ kind: "credential" });
    mocks.initializeApp.mockReturnValue(mocks.initializedApp);
    mocks.getMessaging.mockReturnValue(mocks.messaging);
  });

  it("does not initialize the SDK when the provider module is imported", async () => {
    await import("../src/config/firebase.config.js");

    expect(mocks.cert).not.toHaveBeenCalled();
    expect(mocks.initializeApp).not.toHaveBeenCalled();
    expect(mocks.getMessaging).not.toHaveBeenCalled();
  });

  it("initializes once through the production credential path", async () => {
    const { getFirebaseMessaging, initializeFirebaseAdmin } = await import(
      "../src/config/firebase.config.js"
    );

    const first = initializeFirebaseAdmin(productionConfig);
    const second = initializeFirebaseAdmin(productionConfig);

    expect(mocks.cert).toHaveBeenCalledWith({
      projectId: "obvious-test-project",
      clientEmail: "firebase-admin@example.test",
      privateKey: "obvious-test-line-one\nobvious-test-line-two",
    });
    expect(mocks.initializeApp).toHaveBeenCalledOnce();
    expect(mocks.initializeApp).toHaveBeenCalledWith({
      credential: { kind: "credential" },
    });
    expect(mocks.getMessaging).toHaveBeenCalledWith(mocks.initializedApp);
    expect(mocks.getMessaging).toHaveBeenCalledOnce();
    expect(first).toBe(mocks.messaging);
    expect(second).toBe(mocks.messaging);
    expect(getFirebaseMessaging()).toBe(mocks.messaging);
  });

  it("reuses an existing default app", async () => {
    mocks.getApps.mockReturnValue([mocks.existingApp]);
    const { initializeFirebaseAdmin } = await import("../src/config/firebase.config.js");

    initializeFirebaseAdmin(productionConfig);

    expect(mocks.getApp).toHaveBeenCalledOnce();
    expect(mocks.cert).not.toHaveBeenCalled();
    expect(mocks.initializeApp).not.toHaveBeenCalled();
    expect(mocks.getMessaging).toHaveBeenCalledWith(mocks.existingApp);
  });
});
