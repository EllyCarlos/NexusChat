import type { Request } from "express";
import type {
    AuthenticatedIdentity,
    OAuthCallbackIdentity,
} from "../../modules/auth/contracts/auth-identity.js";

export interface AuthenticatedRequest extends Request {
    user: AuthenticatedIdentity;
}

export interface OAuthAuthenticatedRequest extends Request {
    user?: OAuthCallbackIdentity;
}
