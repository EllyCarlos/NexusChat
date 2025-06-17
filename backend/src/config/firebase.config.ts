import admin from "firebase-admin";
import { createRequire } from "module";

// Create require function for ES modules
const require = createRequire(import.meta.url);

// Use require to load JSON (works in ES modules with createRequire)
const credentials = require("../../firebase-admin-cred.json");

interface ServiceAccountCredentials {
  project_id: string;
  private_key: string;
  client_email: string;
}

const typedCredentials = credentials as ServiceAccountCredentials;

const serviceAccount: admin.ServiceAccount = {
  projectId: typedCredentials.project_id,
  privateKey: typedCredentials.private_key,
  clientEmail: typedCredentials.client_email,
};

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const messaging = admin.messaging();