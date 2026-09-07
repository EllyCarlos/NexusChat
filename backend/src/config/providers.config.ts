import type { RuntimeConfig } from "../interfaces/config/config.interface.js";
import type { LoggerPort } from "../observability/logger.port.js";
import { noopLogger } from "../observability/noop-logger.js";
import { registerGoogleStrategy } from "../passport/google.strategy.js";
import { configureCloudinary } from "./cloudinary.config.js";
import { initializeFirebaseAdmin } from "./firebase.config.js";
import { configureNodemailer } from "./nodemailer.config.js";

let providersInitialized = false;

export const initializeProviders = (
  configuration: RuntimeConfig,
  logger: LoggerPort = noopLogger.forComponent("provider"),
): void => {
  if (providersInitialized) {
    return;
  }

  configureCloudinary(configuration.cloudinary);
  initializeFirebaseAdmin(configuration, logger);
  configureNodemailer(configuration.email, logger);
  registerGoogleStrategy(configuration, logger.forComponent("auth"));
  providersInitialized = true;
};
