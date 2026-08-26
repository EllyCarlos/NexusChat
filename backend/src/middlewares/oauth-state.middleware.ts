import type { CookieOptions, NextFunction, Request, Response } from "express";
import passport from "passport";
import { config } from "../config/env.config.js";
import {
  createOAuthStateBinding,
  OAUTH_STATE_TTL_MS,
  verifyOAuthStateBinding,
} from "../utils/oauth-state.utils.js";

export const OAUTH_STATE_COOKIE_NAME = "nexuschat_oauth_state";

const oauthStateCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: config.app.environment === "production",
  sameSite: "lax",
  path: "/api/v1/auth/google",
};

const getOAuthFailureUrl = (errorCode: string) =>
  `${config.app.clientUrl}/auth/oauth-redirect?error=${errorCode}`;

export const beginGoogleOAuth = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const binding = createOAuthStateBinding();
    res.cookie(OAUTH_STATE_COOKIE_NAME, binding.cookieValue, {
      ...oauthStateCookieOptions,
      maxAge: OAUTH_STATE_TTL_MS,
    });

    return passport.authenticate("google", {
      session: false,
      scope: ["email", "profile"],
      state: binding.state,
    })(req, res, next);
  } catch {
    console.error("OAuth initiation failed.");
    return res.redirect(303, getOAuthFailureUrl("oauth_start_failed"));
  }
};

export const validateGoogleOAuthState = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const cookieValue = req.cookies?.[OAUTH_STATE_COOKIE_NAME] as string | undefined;
  const providedState =
    typeof req.query.state === "string" ? req.query.state : undefined;

  // Consume the one-flow cookie before Passport or application work runs.
  res.clearCookie(OAUTH_STATE_COOKIE_NAME, oauthStateCookieOptions);

  if (!verifyOAuthStateBinding({ providedState, cookieValue })) {
    return res.redirect(303, getOAuthFailureUrl("oauth_state_invalid"));
  }

  return next();
};

export const authenticateGoogleOAuthCallback = (
  req: Request,
  res: Response,
  next: NextFunction,
) => passport.authenticate(
  "google",
  { session: false },
  (error: unknown, user: Express.User | false | null) => {
    if (error || !user) {
      console.error("Google OAuth provider authentication failed.");
      return res.redirect(303, getOAuthFailureUrl("oauth_provider_failed"));
    }

    req.user = user;
    return next();
  },
)(req, res, next);
