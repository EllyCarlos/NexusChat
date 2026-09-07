import nodemailer, { type Transporter } from "nodemailer";
import { ApplicationError } from "../errors/application-error.js";
import type { EmailConfig } from "../interfaces/config/config.interface.js";
import type { LoggerPort } from "../observability/logger.port.js";
import { noopLogger } from "../observability/noop-logger.js";
import { logSafeError } from "../observability/safe-error.js";

let transporter: Transporter | undefined;

export const configureNodemailer = (
  configuration: EmailConfig,
  logger: LoggerPort = noopLogger.forComponent("provider"),
): Transporter => {
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
    logSafeError(logger, "provider.email_initialization.failed", error);
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
