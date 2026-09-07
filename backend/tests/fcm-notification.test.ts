import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFirebaseMessaging: vi.fn(),
  send: vi.fn(),
}));

vi.mock("../src/config/firebase.config.js", () => ({
  getFirebaseMessaging: mocks.getFirebaseMessaging,
}));

import { notificationTitles } from "../src/constants/notification-title.contant.js";
import type { LoggerPort } from "../src/observability/logger.port.js";
import {
  createObservedPushNotificationSender,
  sendPushNotification,
} from "../src/modules/notifications/push-notification.service.js";
import { createCapturingLogger } from "./support/capturing-logger.js";

describe("FCM notification payload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFirebaseMessaging.mockReturnValue({ send: mocks.send });
    mocks.send.mockResolvedValue("message-id");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the configured token, title, and body through Firebase Messaging", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    sendPushNotification({
      recipientToken: "recipient-token",
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
    expect(mocks.send).toHaveBeenCalledWith({
      token: "recipient-token",
      notification: {
        title: "Missed Call",
        body: "You have missed a call",
        imageUrl: "https://res.cloudinary.com/dhdo2yb0w/image/upload/t_media_lib_thumb/logo192_hwepne.png",
      },
      webpush: {
        fcmOptions: {
          link: "/",
        },
      },
    });
    expect(mocks.send.mock.calls[0][0]).not.toHaveProperty("data");
    expect(JSON.stringify([...logSpy.mock.calls, ...errorSpy.mock.calls])).not.toContain("recipient-token");
  });

  it("uses the random fallback for omitted and empty titles without awaiting delivery", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    let resolveSend!: (messageId: string) => void;
    const pendingSend = new Promise<string>((resolve) => {
      resolveSend = resolve;
    });
    mocks.send.mockReturnValue(pendingSend);

    const omittedTitleResult = sendPushNotification({
      recipientToken: "opaque-omitted-title-token",
      body: "Omitted title body",
    });
    const emptyTitleResult = sendPushNotification({
      recipientToken: "opaque-empty-title-token",
      title: "",
      body: "Empty title body",
    });

    expect(omittedTitleResult).toBeUndefined();
    expect(emptyTitleResult).toBeUndefined();
    expect(randomSpy).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenNthCalledWith(1, {
      token: "opaque-omitted-title-token",
      notification: {
        title: notificationTitles[0],
        body: "Omitted title body",
        imageUrl: "https://res.cloudinary.com/dhdo2yb0w/image/upload/t_media_lib_thumb/logo192_hwepne.png",
      },
      webpush: {
        fcmOptions: {
          link: "/",
        },
      },
    });
    expect(mocks.send).toHaveBeenNthCalledWith(2, {
      token: "opaque-empty-title-token",
      notification: {
        title: notificationTitles[0],
        body: "Empty title body",
        imageUrl: "https://res.cloudinary.com/dhdo2yb0w/image/upload/t_media_lib_thumb/logo192_hwepne.png",
      },
      webpush: {
        fcmOptions: {
          link: "/",
        },
      },
    });
    expect(mocks.send.mock.calls[0][0]).not.toHaveProperty("data");
    expect(mocks.send.mock.calls[1][0]).not.toHaveProperty("data");

    resolveSend("message-id");
    await pendingSend;
  });

  it("continues to pass an opaque invalid token to the SDK for handling", () => {
    sendPushNotification({
      recipientToken: "invalid-token",
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
    const sensitiveBody = "Private notification body";
    const providerErrorDetail = "Firebase rejected sensitive-fcm-token";
    mocks.send.mockRejectedValue(new Error(providerErrorDetail));

    const result = sendPushNotification({
      recipientToken: "sensitive-fcm-token",
      title: "Notification",
      body: sensitiveBody,
    });

    expect(result).toBeUndefined();
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(errorSpy).toHaveBeenCalledWith("FCM send failed.", { errorType: "Error" });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("sensitive-fcm-token");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(sensitiveBody);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(providerErrorDetail);
  });

  it("swallows synchronous provider acquisition failures without logging sensitive details", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const sensitiveToken = "sensitive-acquisition-token";
    const sensitiveBody = "Sensitive acquisition body";
    const providerErrorDetail = "Firebase provider acquisition failed privately";
    mocks.getFirebaseMessaging.mockImplementationOnce(() => {
      throw new Error(`${providerErrorDetail}: ${sensitiveToken}: ${sensitiveBody}`);
    });

    const result = sendPushNotification({
      recipientToken: sensitiveToken,
      title: "Notification",
      body: sensitiveBody,
    });

    expect(result).toBeUndefined();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith("FCM send failed.", { errorType: "Error" });
    const loggedOutput = JSON.stringify(errorSpy.mock.calls);
    expect(loggedOutput).not.toContain(sensitiveToken);
    expect(loggedOutput).not.toContain(sensitiveBody);
    expect(loggedOutput).not.toContain(providerErrorDetail);
  });

  it("emits one bounded failure event for observed Firebase delivery without awaiting it", async () => {
    const logger = createCapturingLogger("provider");
    const sensitiveToken = "private-observed-fcm-token";
    const sensitiveBody = "private observed notification body";
    mocks.send.mockRejectedValueOnce(
      new Error(`Firebase rejected ${sensitiveToken}: ${sensitiveBody}`),
    );
    const clock = vi.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(107.5);
    const sendObservedNotification = createObservedPushNotificationSender(logger, clock);

    const result = sendObservedNotification({
      recipientToken: sensitiveToken,
      title: "Notification",
      body: sensitiveBody,
    });

    expect(result).toBeUndefined();
    await vi.waitFor(() => expect(logger.events).toHaveLength(1));
    expect(logger.events).toEqual([{
      level: "error",
      component: "provider",
      event: "provider.push_delivery.failed",
      fields: {
        provider: "firebase",
        operation: "push_send",
        errorCategory: "provider",
        result: "failed",
        durationMs: 7.5,
        errorType: "Error",
      },
    }]);
    expect(JSON.stringify(logger.events)).not.toContain(sensitiveToken);
    expect(JSON.stringify(logger.events)).not.toContain(sensitiveBody);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("keeps Firebase failure fire-and-forget when the observed logger throws", async () => {
    const throwFromLogger = () => {
      throw new Error("logger unavailable");
    };
    const throwingLogger: LoggerPort = {
      component: "provider",
      forComponent: () => throwingLogger,
      debug: throwFromLogger,
      info: throwFromLogger,
      warn: throwFromLogger,
      error: throwFromLogger,
    };
    mocks.send.mockRejectedValueOnce(new Error("private Firebase failure"));
    const sendObservedNotification = createObservedPushNotificationSender(
      throwingLogger,
      vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(11),
    );

    expect(sendObservedNotification({
      recipientToken: "opaque-token",
      body: "opaque body",
    })).toBeUndefined();

    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
  });
});
