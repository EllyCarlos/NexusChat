import type { IConfig } from "../interfaces/config/config.interface.js";
import { env } from "../schemas/env.schema.js";

const developmentConfig: IConfig = {
    clientUrl: "http://localhost:3000",
    callbackUrl: `http://localhost:${env.PORT}/api/v1/auth/google/callback`,
    cookieDomain: undefined, // No domain for localhost
    jwtIssuer: "nexus-chat-local",
    jwtAudience: "http://localhost:3000"
};

const productionConfig: IConfig = {
    clientUrl: "https://nexuswebapp.vercel.app",
    callbackUrl: "https://nexuschat-4slv.onrender.com/api/v1/auth/google/callback",
    cookieDomain: "https://nexuschat-4slv.onrender.com", // Your production domain
    jwtIssuer: "https://nexuschat-4slv.onrender.com",
    jwtAudience: "https://nexuswebapp.vercel.app"
};

export const config: IConfig = env.NODE_ENV === 'DEVELOPMENT' 
    ? developmentConfig 
    : productionConfig;