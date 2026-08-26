import type { NodeEnvironment } from "../../schemas/env.schema.js";

export interface AppConfig {
  readonly environment: NodeEnvironment;
  readonly port: string;
  readonly clientUrl: string;
  readonly serverUrl: string;
  readonly cookieDomain?: string;
  readonly vercelUrl?: string;
  readonly frontendUrl: string;
}

export interface AuthConfig {
  readonly jwtSecret: string;
  readonly jwtTokenExpirationDays: string;
  readonly otpExpirationMinutes: string;
  readonly passwordResetTokenExpirationMinutes: string;
}

export interface OAuthConfig {
  readonly googleClientId: string;
  readonly googleClientSecret: string;
  readonly callbackUrl: string;
}

export interface DatabaseConfig {
  readonly url: string;
  readonly directUrl: string;
}

export interface FirebaseConfig {
  readonly projectId?: string;
  readonly clientEmail?: string;
  readonly privateKey?: string;
  readonly applicationCredentialsPath: string;
}

export interface CloudinaryConfig {
  readonly cloudName: string;
  readonly apiKey: string;
  readonly apiSecret: string;
}

export interface EmailConfig {
  readonly sender: string;
  readonly password: string;
}

export interface UploadConfig {
  readonly tempDirectory: string;
}

export interface RuntimeConfig {
  readonly app: AppConfig;
  readonly auth: AuthConfig;
  readonly oauth: OAuthConfig;
  readonly database: DatabaseConfig;
  readonly firebase: FirebaseConfig;
  readonly cloudinary: CloudinaryConfig;
  readonly email: EmailConfig;
  readonly upload: UploadConfig;
}
