import { config } from "dotenv";
import { z } from "zod";

// Load the correct .env file based on NODE_ENV
const envFile = `.env.${process.env.NODE_ENV === "DEVELOPMENT" ? "development" : "production"}`;
config({ path: envFile });

const envSchema = z.object({
    NODE_ENV: z.enum(['DEVELOPMENT', 'PRODUCTION']).default("DEVELOPMENT"),
    PORT: z.string({ required_error: "PORT is required" })
        .max(4, 'Port cannot be more than 4 digits')
        .min(4, 'Port number cannot be lesser than 4 digits'),
    JWT_SECRET: z.string({ required_error: "JWT_SECRET is required" }),
    JWT_TOKEN_EXPIRATION_DAYS: z.string({ required_error: "JWT_TOKEN_EXPIRATION_DAYS is required" })
        .min(1, 'JWT_TOKEN_EXPIRATION_DAYS cannot be less than 1'),
    EMAIL: z.string().email("Please provide a valid email"),
    PASSWORD: z.string({ required_error: "Password for email is required" }),
    OTP_EXPIRATION_MINUTES: z.string({ required_error: "OTP_EXPIRATION_MINUTES is required" }),
    PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES: z.string({ required_error: "PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES is required" }),
    CLOUDINARY_CLOUD_NAME: z.string({ required_error: "CLOUDINARY_CLOUD_NAME is required" }),
    CLOUDINARY_API_KEY: z.string({ required_error: "CLOUDINARY_API_KEY is required" }),
    CLOUDINARY_API_SECRET: z.string({ required_error: "CLOUDINARY_API_SECRET is required" }),
    GOOGLE_CLIENT_ID: z.string({ required_error: "GOOGLE_CLIENT_ID is required" }),
    GOOGLE_CLIENT_SECRET: z.string({ required_error: "GOOGLE_CLIENT_SECRET is required" }),
    GOOGLE_APPLICATION_CREDENTIALS: z.string({ required_error: "GOOGLE_APPLICATION_CREDENTIALS is required" }),
    PRIVATE_KEY_RECOVERY_SECRET: z.string({ required_error: "PRIVATE_KEY_RECOVERY_SECRET is required" }),
    DATABASE_URL: z.string({ required_error: "DATABASE_URL is required" }),
    DIRECT_URL: z.string({ required_error: "DIRECT_URL is required" })
});


export const checkEnvVariables = () => {
    const parsedEnv = envSchema.safeParse(process.env);
    if (!parsedEnv.success) {
        console.error("❌ Invalid environment variables:", parsedEnv.error.flatten().fieldErrors);
        process.exit(1);
    }
    return parsedEnv.data;
};

export const env = checkEnvVariables();





