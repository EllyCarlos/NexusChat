import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { ApplicationError } from "../errors/application-error.js";

const nodeEnvironmentSchema = z.enum(["development", "production", "test"]);

const redisUrlValueSchema = z.string().url().refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "redis:" || protocol === "rediss:";
  } catch {
    return false;
  }
}, "REDIS_URL must use redis:// or rediss://");

const optionalRedisUrlSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}, redisUrlValueSchema.optional());

const environmentSchema = z.object({
  NODE_ENV: nodeEnvironmentSchema,
  PORT: z.string({ required_error: "PORT is required" })
    .max(4, "Port cannot be more than 4 digits")
    .min(4, "Port number cannot be lesser than 4 digits"),
  JWT_SECRET: z.string({ required_error: "JWT_SECRET is required" }),
  JWT_TOKEN_EXPIRATION_DAYS: z.string({ required_error: "JWT_TOKEN_EXPIRATION_DAYS is required" })
    .min(1, "JWT_TOKEN_EXPIRATION_DAYS cannot be less than 1"),
  EMAIL: z.string().email("Please provide a valid email"),
  PASSWORD: z.string({ required_error: "Password for email is required" }),
  OTP_EXPIRATION_MINUTES: z.string({ required_error: "OTP_EXPIRATION_MINUTES is required" }),
  PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES: z.string({
    required_error: "PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES is required",
  }),
  CLOUDINARY_CLOUD_NAME: z.string({ required_error: "CLOUDINARY_CLOUD_NAME is required" }),
  CLOUDINARY_API_KEY: z.string({ required_error: "CLOUDINARY_API_KEY is required" }),
  CLOUDINARY_API_SECRET: z.string({ required_error: "CLOUDINARY_API_SECRET is required" }),
  GOOGLE_CLIENT_ID: z.string({ required_error: "GOOGLE_CLIENT_ID is required" }),
  GOOGLE_CLIENT_SECRET: z.string({ required_error: "GOOGLE_CLIENT_SECRET is required" }),
  GOOGLE_APPLICATION_CREDENTIALS: z.string({
    required_error: "GOOGLE_APPLICATION_CREDENTIALS is required",
  }),
  DATABASE_URL: z.string({ required_error: "DATABASE_URL is required" }),
  DIRECT_URL: z.string({ required_error: "DIRECT_URL is required" }),
  REDIS_URL: optionalRedisUrlSchema,
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  NEXUSCHAT_UPLOAD_TEMP_DIR: z.string().optional(),
  FRONTEND_URL: z.string().optional(),
  CLIENT_URL: z.string().optional(),
}).superRefine((environment, context) => {
  if (environment.NODE_ENV !== "production") {
    return;
  }

  for (const variableName of [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
  ] as const) {
    if (!environment[variableName]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [variableName],
        message: `${variableName} is required in production`,
      });
    }
  }
});

export type NodeEnvironment = z.infer<typeof nodeEnvironmentSchema>;
export type Environment = z.infer<typeof environmentSchema>;

export const CONFIGURATION_ERROR_CODE = "CONFIGURATION_INVALID";

const configurationError = (variableNames: readonly string[]) => {
  const names = [...new Set(variableNames)].sort();
  return new ApplicationError({
    code: CONFIGURATION_ERROR_CODE,
    message: `Invalid environment variables: ${names.join(", ")}`,
    statusCode: 500,
  });
};

export const parseNodeEnvironment = (value: string | undefined): NodeEnvironment => {
  const parsedEnvironment = nodeEnvironmentSchema.safeParse(value ?? "development");
  if (!parsedEnvironment.success) {
    throw configurationError(["NODE_ENV"]);
  }
  return parsedEnvironment.data;
};

export const parseEnvironment = (
  source: Record<string, string | undefined>,
): Environment => {
  const parsedEnvironment = environmentSchema.safeParse(source);
  if (!parsedEnvironment.success) {
    const variableNames = parsedEnvironment.error.issues.map((issue) =>
      typeof issue.path[0] === "string" ? issue.path[0] : "ENVIRONMENT",
    );
    throw configurationError(variableNames);
  }
  return parsedEnvironment.data;
};

type LoadEnvironmentOptions = {
  source?: NodeJS.ProcessEnv;
  loadFile?: typeof loadDotenv;
};

export const loadEnvironment = ({
  source = process.env,
  loadFile = loadDotenv,
}: LoadEnvironmentOptions = {}): Environment => {
  const nodeEnvironment = parseNodeEnvironment(source.NODE_ENV);
  loadFile({
    path: `.env.${nodeEnvironment}`,
    processEnv: source as Record<string, string>,
  });
  source.NODE_ENV = nodeEnvironment;
  return parseEnvironment(source);
};
