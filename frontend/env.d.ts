// env.d.ts
declare namespace NodeJS {
  interface ProcessEnv {
    
    NEXT_PUBLIC_TENOR_API_KEY: string;
    NEXT_PUBLIC_FIREBASE_API_KEY: string;
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: string;
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: string;
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: string;
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: string;
    NEXT_PUBLIC_FIREBASE_APP_ID: string;
    NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: string;
    NEXT_PUBLIC_BASE_URL: string;
    NEXT_PUBLIC_ABSOLUTE_BASE_URL: string;
    NEXT_PUBLIC_FIREBASE_FCM_VAPID_KEY: string;

    SESSION_SECRET: string;
    NEXT_PUBLIC_CLIENT_URL: string;
    EMAIL: string;
    PASSWORD: string;
    // Server-only compatibility reader for pre-V2 OAuth backups.
    // Remove only after no OAuth legacy-v1 records remain.
    PRIVATE_KEY_RECOVERY_SECRET: string;
    // Canonical Base64 encoding of exactly 32 random bytes. Server-only.
    PRIVATE_KEY_RECOVERY_KEK_V1?: string;

  }
}
