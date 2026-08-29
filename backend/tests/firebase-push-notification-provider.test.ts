import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFirebaseMessaging: vi.fn(),
  send: vi.fn(),
}));

vi.mock("../src/config/firebase.config.js", () => ({
  getFirebaseMessaging: mocks.getFirebaseMessaging,
}));

const notification = {
  recipientToken: "opaque-recipient-token",
  title: "Notification title",
  body: "Notification body",
};

describe("Firebase push notification provider", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getFirebaseMessaging.mockReturnValue({ send: mocks.send });
    mocks.send.mockResolvedValue("provider-message-id");
  });

  it("does not acquire Firebase Messaging when the adapter is imported", async () => {
    await import("../src/modules/notifications/infrastructure/firebase-push-notification.provider.js");

    expect(mocks.getFirebaseMessaging).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("maps the neutral request to the exact Firebase payload and hides the provider response", async () => {
    const { firebasePushNotificationProvider } = await import(
      "../src/modules/notifications/infrastructure/firebase-push-notification.provider.js"
    );

    const delivery = firebasePushNotificationProvider.deliver(notification);

    expect(mocks.getFirebaseMessaging).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledWith({
      token: "opaque-recipient-token",
      notification: {
        title: "Notification title",
        body: "Notification body",
        imageUrl: "https://res.cloudinary.com/dhdo2yb0w/image/upload/t_media_lib_thumb/logo192_hwepne.png",
      },
      webpush: {
        fcmOptions: {
          link: "/",
        },
      },
    });
    expect(mocks.send.mock.calls[0][0]).not.toHaveProperty("data");
    await expect(delivery).resolves.toBeUndefined();
  });

  it("propagates synchronous Firebase getter and send failures", async () => {
    const { firebasePushNotificationProvider } = await import(
      "../src/modules/notifications/infrastructure/firebase-push-notification.provider.js"
    );
    const getterError = new Error("synchronous getter failure");
    mocks.getFirebaseMessaging.mockImplementationOnce(() => {
      throw getterError;
    });

    expect(() => firebasePushNotificationProvider.deliver(notification)).toThrow(getterError);
    expect(mocks.send).not.toHaveBeenCalled();

    const sendError = new Error("synchronous send failure");
    mocks.send.mockImplementationOnce(() => {
      throw sendError;
    });

    expect(() => firebasePushNotificationProvider.deliver(notification)).toThrow(sendError);
  });

  it("propagates asynchronous Firebase rejection to the application boundary", async () => {
    const { firebasePushNotificationProvider } = await import(
      "../src/modules/notifications/infrastructure/firebase-push-notification.provider.js"
    );
    const providerError = new Error("asynchronous provider rejection");
    mocks.send.mockRejectedValueOnce(providerError);

    const delivery = firebasePushNotificationProvider.deliver(notification);

    await expect(delivery).rejects.toBe(providerError);
  });
});
