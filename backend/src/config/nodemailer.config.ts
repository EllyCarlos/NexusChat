import nodemailer, { type Transporter } from "nodemailer";
import { ApplicationError } from "../errors/application-error.js";
import type { EmailConfig } from "../interfaces/config/config.interface.js";
import { logServerError } from "../utils/safe-logger.utils.js";

let transporter: Transporter | undefined;

export const configureNodemailer = (configuration: EmailConfig): Transporter => {
  if (transporter) {
    return transporter;
  }

  try {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: configuration.sender,
        pass: configuration.password,
      },
    });
    return transporter;
  } catch (error) {
    logServerError("Email transporter initialization failed.", error);
    throw new ApplicationError({
      code: "EMAIL_PROVIDER_INITIALIZATION_FAILED",
      message: "Email provider initialization failed.",
      statusCode: 500,
    });
  }
};

export const getEmailTransporter = (): Transporter => {
  if (!transporter) {
    throw new ApplicationError({
      code: "EMAIL_PROVIDER_NOT_INITIALIZED",
      message: "Email provider is not initialized.",
      statusCode: 500,
    });
  }
  return transporter;
};
