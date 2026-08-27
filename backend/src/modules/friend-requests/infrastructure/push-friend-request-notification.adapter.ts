import { sendPushNotification } from "../../notifications/push-notification.service.js";
import type { FriendRequestNotificationPort } from "../contracts/friend-request-notification.port.js";

export const pushFriendRequestNotificationAdapter: FriendRequestNotificationPort = {
  notify: ({ recipientToken, body }) => {
    sendPushNotification({ recipientToken, body });
  },
};
