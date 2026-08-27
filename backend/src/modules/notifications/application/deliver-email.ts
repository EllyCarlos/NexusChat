import type {
  EmailDeliveryMessage,
  EmailDeliveryProvider,
} from "../contracts/email-delivery.provider.js";

type EmailDeliveryDependencies = {
  emailDeliveryProvider: EmailDeliveryProvider;
};

export const createEmailDeliverer = ({
  emailDeliveryProvider,
}: EmailDeliveryDependencies) => async (
  message: EmailDeliveryMessage,
): Promise<void> => {
  await emailDeliveryProvider.deliver(message);
};
