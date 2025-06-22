// interfaces/config/config.interface.ts
export interface IConfig {
    clientUrl: string;
    callbackUrl: string;
    cookieDomain?: string; // Optional for development
    jwtIssuer: string;
    jwtAudience: string;
}