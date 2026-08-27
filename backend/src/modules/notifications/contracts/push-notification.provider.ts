export type PushNotificationMessage = {
  recipientToken: string;
  title: string;
  body: string;
};

export interface PushNotificationProvider {
  deliver(message: PushNotificationMessage): Promise<void>;
}
