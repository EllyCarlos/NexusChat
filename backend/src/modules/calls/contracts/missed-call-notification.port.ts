export interface MissedCallNotificationInput {
  recipientToken: string;
  title: "Missed Call";
  body: string;
}

export type MissedCallNotificationPort = (
  input: MissedCallNotificationInput,
) => void;
