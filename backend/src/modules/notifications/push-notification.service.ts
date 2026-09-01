import type { LoggerPort } from "../../observability/logger.port.js";
import {
  emitOperationError,
  type OperationClock,
} from "../../observability/operation-observer.js";
import { notificationTitles } from "../../constants/notification-title.contant.js";
import { createPushNotificationSender } from "./application/send-push-notification.js";
import { firebasePushNotificationProvider } from "./infrastructure/firebase-push-notification.provider.js";

const selectFallbackTitle = (): string => `${
  notificationTitles[Math.floor(Math.random() * notificationTitles.length)]
}`;

export const sendPushNotification = createPushNotificationSender({
  provider: firebasePushNotificationProvider,
  selectFallbackTitle,
});

export const createObservedPushNotificationSender = (
  logger: LoggerPort,
  clock?: OperationClock,
) => createPushNotificationSender({
  provider: firebasePushNotificationProvider,
  selectFallbackTitle,
  ...(clock ? { clock } : {}),
  onDeliveryFailure: (error, durationMs) => {
    emitOperationError(logger, "provider.push_delivery.failed", error, {
      provider: "firebase",
      operation: "push_send",
      errorCategory: "provider",
      result: "failed",
      durationMs,
    });
  },
});
