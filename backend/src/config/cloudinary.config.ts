import { v2 as cloudinary } from "cloudinary";
import type { CloudinaryConfig } from "../interfaces/config/config.interface.js";

let isConfigured = false;

export const configureCloudinary = (configuration: CloudinaryConfig): void => {
  if (isConfigured) {
    return;
  }

  cloudinary.config({
    cloud_name: configuration.cloudName,
    api_key: configuration.apiKey,
    api_secret: configuration.apiSecret,
  });
  isConfigured = true;
};
