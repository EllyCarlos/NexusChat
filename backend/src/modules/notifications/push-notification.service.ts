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
