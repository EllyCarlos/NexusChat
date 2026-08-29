import type { RuntimeConfig } from "../interfaces/config/config.interface.js";
import { registerGoogleStrategy } from "../passport/google.strategy.js";
import { configureCloudinary } from "./cloudinary.config.js";
import { initializeFirebaseAdmin } from "./firebase.config.js";
import { configureNodemailer } from "./nodemailer.config.js";

let providersInitialized = false;

export const initializeProviders = (configuration: RuntimeConfig): void => {
  if (providersInitialized) {
    return;
  }

  configureCloudinary(configuration.cloudinary);
  initializeFirebaseAdmin(configuration);
  configureNodemailer(configuration.email);
  registerGoogleStrategy(configuration);
  providersInitialized = true;
};
