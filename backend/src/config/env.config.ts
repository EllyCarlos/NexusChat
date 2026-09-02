import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeConfig } from "../interfaces/config/config.interface.js";
import { loadEnvironment, type Environment } from "../schemas/env.schema.js";

const DEVELOPMENT_CLIENT_URL = "http://localhost:3000";
const PRODUCTION_CLIENT_URL = "https://nexuswebapp.vercel.app";
const PRODUCTION_SERVER_URL = "https://nexuschat-4slv.onrender.com";

export const createRuntimeConfig = (environment: Environment): RuntimeConfig => {
  const isProduction = environment.NODE_ENV === "production";
  const clientUrl = isProduction ? PRODUCTION_CLIENT_URL : DEVELOPMENT_CLIENT_URL;
  const serverUrl = isProduction
    ? PRODUCTION_SERVER_URL
    : `http://localhost:${environment.PORT}`;

  return Object.freeze({
    app: Object.freeze({
      environment: environment.NODE_ENV,
      port: environment.PORT,
      clientUrl,
      serverUrl,
      cookieDomain: isProduction ? PRODUCTION_SERVER_URL : undefined,
      vercelUrl: environment.VERCEL_URL || undefined,
      frontendUrl: environment.FRONTEND_URL || environment.CLIENT_URL || PRODUCTION_CLIENT_URL,
    }),
    auth: Object.freeze({
      jwtSecret: environment.JWT_SECRET,
      jwtTokenExpirationDays: environment.JWT_TOKEN_EXPIRATION_DAYS,
      otpExpirationMinutes: environment.OTP_EXPIRATION_MINUTES,
      passwordResetTokenExpirationMinutes: environment.PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES,
    }),
    oauth: Object.freeze({
      googleClientId: environment.GOOGLE_CLIENT_ID,
      googleClientSecret: environment.GOOGLE_CLIENT_SECRET,
      callbackUrl: isProduction
        ? `${PRODUCTION_SERVER_URL}/api/v1/auth/google/callback`
        : `${serverUrl}/api/v1/auth/google/callback`,
    }),
    database: Object.freeze({
      url: environment.DATABASE_URL,
      directUrl: environment.DIRECT_URL,
    }),
    redis: Object.freeze({
      url: environment.REDIS_URL,
    }),
    metrics: Object.freeze({
      enabled: environment.METRICS_ENABLED,
      bearerToken: environment.METRICS_BEARER_TOKEN,
    }),
    firebase: Object.freeze({
      projectId: environment.FIREBASE_PROJECT_ID || undefined,
      clientEmail: environment.FIREBASE_CLIENT_EMAIL || undefined,
      privateKey: environment.FIREBASE_PRIVATE_KEY || undefined,
      applicationCredentialsPath: environment.GOOGLE_APPLICATION_CREDENTIALS,
    }),
    cloudinary: Object.freeze({
      cloudName: environment.CLOUDINARY_CLOUD_NAME,
      apiKey: environment.CLOUDINARY_API_KEY,
      apiSecret: environment.CLOUDINARY_API_SECRET,
    }),
    email: Object.freeze({
      sender: environment.EMAIL,
      password: environment.PASSWORD,
    }),
    upload: Object.freeze({
      tempDirectory: environment.NEXUSCHAT_UPLOAD_TEMP_DIR || join(tmpdir(), "nexuschat-uploads"),
    }),
  });
};

export const config = createRuntimeConfig(loadEnvironment());
