import type { Message } from "firebase-admin/messaging";
import { getFirebaseMessaging } from "../../../config/firebase.config.js";
import type { PushNotificationProvider } from "../contracts/push-notification.provider.js";

const NOTIFICATION_IMAGE_URL = "https://res.cloudinary.com/dhdo2yb0w/image/upload/t_media_lib_thumb/logo192_hwepne.png";

export const firebasePushNotificationProvider: PushNotificationProvider = {
  deliver({ recipientToken, title, body }): Promise<void> {
    const payload: Message = {
      token: recipientToken,
      notification: {
        title,
        body,
        imageUrl: NOTIFICATION_IMAGE_URL,
      },
      webpush: {
        fcmOptions: {
          link: "/",
        },
      },
    };

    return getFirebaseMessaging().send(payload).then(() => undefined);
  },
};
