import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock("../src/config/firebase.config.js", () => ({
  messaging: { send: mocks.send },
}));

import { sendPushNotification } from "../src/utils/generic.js";

describe("FCM notification payload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.send.mockResolvedValue("message-id");
  });

  it("sends the configured token, title, and body through Firebase Messaging", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    sendPushNotification({
      fcmToken: "recipient-token",
      title: "Missed Call",
      body: "You have missed a call",
    });

    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      token: "recipient-token",
      notification: expect.objectContaining({
        title: "Missed Call",
        body: "You have missed a call",
      }),
    }));
    expect(mocks.send.mock.calls[0][0]).not.toHaveProperty("data");
    expect(JSON.stringify([...logSpy.mock.calls, ...errorSpy.mock.calls])).not.toContain("recipient-token");
  });

  it("continues to pass an opaque invalid token to the SDK for handling", () => {
    sendPushNotification({
      fcmToken: "invalid-token",
      title: "Notification",
      body: "Body",
    });

    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      token: "invalid-token",
    }));
  });

  it("does not log the registration token when Firebase rejects the send", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.send.mockRejectedValue(new Error("Firebase rejected sensitive-fcm-token"));

    sendPushNotification({
      fcmToken: "sensitive-fcm-token",
      title: "Notification",
      body: "Body",
    });

    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("sensitive-fcm-token");
  });
});
