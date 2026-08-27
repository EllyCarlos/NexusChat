import { createEmailDeliverer } from "./application/deliver-email.js";
import { nodemailerEmailDeliveryProvider } from "./infrastructure/nodemailer-email-delivery.provider.js";

export const deliverEmail = createEmailDeliverer({
  emailDeliveryProvider: nodemailerEmailDeliveryProvider,
});
