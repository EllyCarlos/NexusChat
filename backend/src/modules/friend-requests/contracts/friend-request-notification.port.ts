export type FriendRequestNotificationInput = {
  recipientToken: string;
  body: string;
};

export interface FriendRequestNotificationPort {
  notify({ recipientToken, body }: FriendRequestNotificationInput): void;
}
