import { cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { createRequire } from "module";
import { env } from "../schemas/env.schema.js";

interface ServiceAccountCredentials {
  project_id: string;
  private_key: string;
  client_email: string;
}

let serviceAccount: ServiceAccount;

if (env.NODE_ENV === 'production') {
  // Production: Use environment variables
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    throw new Error('Missing Firebase environment variables. Please set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY');
  }
  
  serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Handle escaped newlines
  };
} else {
  // Development: Use local JSON file
  try {
    const require = createRequire(import.meta.url);
    const credentials = require("../../firebase-admin-cred.json");
    const typedCredentials = credentials as ServiceAccountCredentials;
    
    serviceAccount = {
      projectId: typedCredentials.project_id,
      privateKey: typedCredentials.private_key,
      clientEmail: typedCredentials.client_email,
    };
  } catch (error) {
    console.error('Failed to load Firebase credentials file:', error);
    throw new Error('Firebase credentials file not found. Please ensure firebase-admin-cred.json exists in development.');
  }
}

// Initialize Firebase Admin SDK
if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

export const messaging = getMessaging();
