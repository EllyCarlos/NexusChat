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

export interface IAvatar {
    secureUrl:string,
    publicId:string
}

export interface IGithub {
    id:string
    displayName:string
    username:string
    photos:Array<{value:string}>
    _json:{email:string}
}
