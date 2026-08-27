export type EmailDeliveryMessage = Readonly<{
  from: string;
  to: string;
  subject: string;
  html: string;
}>;

export interface EmailDeliveryProvider {
  deliver(message: EmailDeliveryMessage): Promise<void>;
}
