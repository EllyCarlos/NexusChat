import {
  cert,
  getApp,
  getApps,
  initializeApp,
  type ServiceAccount,
} from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { createRequire } from "node:module";
import { ApplicationError } from "../errors/application-error.js";
import type { RuntimeConfig } from "../interfaces/config/config.interface.js";
import { logServerError } from "../utils/safe-logger.utils.js";

interface ServiceAccountCredentials {
  project_id: string;
  private_key: string;
  client_email: string;
}

let messaging: Messaging | undefined;

const loadDevelopmentServiceAccount = (): ServiceAccount => {
  try {
    const require = createRequire(import.meta.url);
    const credentials = require("../../firebase-admin-cred.json") as ServiceAccountCredentials;
    return {
      projectId: credentials.project_id,
      privateKey: credentials.private_key,
      clientEmail: credentials.client_email,
    };
  } catch (error) {
    logServerError("Firebase credentials loading failed.", error);
    throw new ApplicationError({
      code: "FIREBASE_CONFIGURATION_UNAVAILABLE",
      message: "Firebase credentials unavailable.",
      statusCode: 500,
    });
  }
};

const loadProductionServiceAccount = (
  configuration: RuntimeConfig["firebase"],
): ServiceAccount => {
  if (!configuration.projectId || !configuration.clientEmail || !configuration.privateKey) {
    throw new ApplicationError({
      code: "FIREBASE_CONFIGURATION_UNAVAILABLE",
      message: "Firebase credentials unavailable.",
      statusCode: 500,
    });
  }

  return {
    projectId: configuration.projectId,
    clientEmail: configuration.clientEmail,
    privateKey: configuration.privateKey.replace(/\\n/g, "\n"),
  };
};

export const initializeFirebaseAdmin = (
  configuration: Pick<RuntimeConfig, "app" | "firebase">,
): Messaging => {
  if (messaging) {
    return messaging;
  }

  const serviceAccount = configuration.app.environment === "production"
    ? loadProductionServiceAccount(configuration.firebase)
    : loadDevelopmentServiceAccount();
  const firebaseApp = getApps().length > 0
    ? getApp()
    : initializeApp({ credential: cert(serviceAccount) });

  messaging = getMessaging(firebaseApp);
  return messaging;
};

export const getFirebaseMessaging = (): Messaging => {
  if (!messaging) {
    throw new ApplicationError({
      code: "FIREBASE_NOT_INITIALIZED",
      message: "Firebase provider is not initialized.",
      statusCode: 500,
    });
  }
  return messaging;
};
