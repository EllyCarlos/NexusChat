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
});
