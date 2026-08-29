import { logServerError } from "../../../utils/safe-logger.utils.js";
import type { PushNotificationProvider } from "../contracts/push-notification.provider.js";

type SendPushNotificationDependencies = {
  provider: PushNotificationProvider;
  selectFallbackTitle: () => string;
};

export type SendPushNotificationInput = {
  recipientToken: string;
  title?: string;
  body: string;
};

export const createPushNotificationSender = ({
  provider,
  selectFallbackTitle,
}: SendPushNotificationDependencies) => ({
  recipientToken,
  title,
  body,
}: SendPushNotificationInput): void => {
  try {
    console.log("Push notification requested.");
    const delivery = provider.deliver({
      recipientToken,
      title: title ? title : selectFallbackTitle(),
      body,
    });
    void delivery.catch((error) => {
      logServerError("FCM send failed.", error);
    });
  } catch (error) {
    logServerError("FCM send failed.", error);
  }
};
