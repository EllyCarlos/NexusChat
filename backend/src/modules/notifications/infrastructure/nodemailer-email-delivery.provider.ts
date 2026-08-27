import { getEmailTransporter } from "../../../config/nodemailer.config.js";
import type { EmailDeliveryProvider } from "../contracts/email-delivery.provider.js";

export const nodemailerEmailDeliveryProvider: EmailDeliveryProvider = {
  async deliver(message): Promise<void> {
    await getEmailTransporter().sendMail(message);
  },
};
