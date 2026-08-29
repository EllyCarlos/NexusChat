import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPushNotificationSender } from "../src/modules/notifications/application/send-push-notification.js";

const mocks = {
  deliver: vi.fn(),
  selectFallbackTitle: vi.fn(),
};

const createSender = () => createPushNotificationSender({
  provider: { deliver: mocks.deliver },
  selectFallbackTitle: mocks.selectFallbackTitle,
});

describe("push notification application boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deliver.mockResolvedValue(undefined);
    mocks.selectFallbackTitle.mockReturnValue("Fallback title");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards a supplied title and returns before provider delivery settles", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let resolveDelivery!: () => void;
    const pendingDelivery = new Promise<void>((resolve) => {
      resolveDelivery = resolve;
    });
    mocks.deliver.mockReturnValue(pendingDelivery);
    const sendPushNotification = createSender();

    const result = sendPushNotification({
      recipientToken: "opaque-recipient-token",
      title: "Missed Call",
      body: "You have missed a call",
    });

    expect(result).toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith("Push notification requested.");
    expect(mocks.selectFallbackTitle).not.toHaveBeenCalled();
    expect(mocks.deliver).toHaveBeenCalledOnce();
    expect(mocks.deliver).toHaveBeenCalledWith({
      recipientToken: "opaque-recipient-token",
      title: "Missed Call",
      body: "You have missed a call",
    });

    resolveDelivery();
    await pendingDelivery;
  });

  it("uses the injected fallback selector for omitted and empty titles", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.selectFallbackTitle
      .mockReturnValueOnce("First fallback")
      .mockReturnValueOnce("Second fallback");
    const sendPushNotification = createSender();

    sendPushNotification({
      recipientToken: "omitted-title-token",
      body: "Omitted title body",
    });
    sendPushNotification({
      recipientToken: "empty-title-token",
      title: "",
      body: "Empty title body",
    });

    expect(mocks.selectFallbackTitle).toHaveBeenCalledTimes(2);
    expect(mocks.deliver).toHaveBeenNthCalledWith(1, {
      recipientToken: "omitted-title-token",
      title: "First fallback",
      body: "Omitted title body",
    });
    expect(mocks.deliver).toHaveBeenNthCalledWith(2, {
      recipientToken: "empty-title-token",
      title: "Second fallback",
      body: "Empty title body",
    });
  });

  it("swallows synchronous provider failures and logs only safe metadata", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sensitiveToken = "sensitive-sync-token";
    const sensitiveBody = "Sensitive synchronous body";
    const providerErrorDetail = "Private synchronous Firebase detail";
    mocks.deliver.mockImplementationOnce(() => {
      throw new Error(`${providerErrorDetail}: ${sensitiveToken}: ${sensitiveBody}`);
    });
    const sendPushNotification = createSender();

    const result = sendPushNotification({
      recipientToken: sensitiveToken,
      title: "Notification",
      body: sensitiveBody,
    });

    expect(result).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith("FCM send failed.", { errorType: "Error" });
    const loggedOutput = JSON.stringify(errorSpy.mock.calls);
    expect(loggedOutput).not.toContain(sensitiveToken);
    expect(loggedOutput).not.toContain(sensitiveBody);
    expect(loggedOutput).not.toContain(providerErrorDetail);
  });

  it("consumes asynchronous provider rejection without exposing sensitive details", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sensitiveToken = "sensitive-async-token";
    const sensitiveBody = "Sensitive asynchronous body";
    const providerErrorDetail = "Private asynchronous Firebase detail";
    mocks.deliver.mockRejectedValueOnce(
      new Error(`${providerErrorDetail}: ${sensitiveToken}: ${sensitiveBody}`),
    );
    const sendPushNotification = createSender();

    const result = sendPushNotification({
      recipientToken: sensitiveToken,
      title: "Notification",
      body: sensitiveBody,
    });

    expect(result).toBeUndefined();
    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith("FCM send failed.", { errorType: "Error" });
    });
    const loggedOutput = JSON.stringify(errorSpy.mock.calls);
    expect(loggedOutput).not.toContain(sensitiveToken);
    expect(loggedOutput).not.toContain(sensitiveBody);
    expect(loggedOutput).not.toContain(providerErrorDetail);
  });
});
