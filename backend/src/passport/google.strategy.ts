import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import type { RuntimeConfig } from "../interfaces/config/config.interface.js";
import { provisionGoogleAccount } from "../modules/auth/google-account.service.js";
import type { LoggerPort } from "../observability/logger.port.js";
import { noopLogger } from "../observability/noop-logger.js";
import { logSafeError } from "../observability/safe-error.js";

let isRegistered = false;

export const registerGoogleStrategy = (
  configuration: Pick<RuntimeConfig, "oauth">,
  logger: LoggerPort = noopLogger.forComponent("auth"),
): void => {
  if (isRegistered) {
    return;
  }

  passport.use(new GoogleStrategy({
    clientID: configuration.oauth.googleClientId,
    clientSecret: configuration.oauth.googleClientSecret,
    callbackURL: configuration.oauth.callbackUrl,
  }, async function (_accessToken, _refreshToken, profile, done) {
    try {
      if (profile.emails && profile.emails[0].value && profile.displayName) {
        const identity = await provisionGoogleAccount({
          providerId: profile.id,
          email: profile.emails[0].value,
          displayName: profile.displayName,
          givenName: profile.name?.givenName!,
          avatarUrl: profile.photos && profile.photos[0].value,
        });
        done(null, identity);
        return;
      }
      throw new Error("Some Error occured");
    } catch (error) {
      logSafeError(logger, "auth.oauth_profile.failed", error);
      done(null, false);
    }
  }));
  isRegistered = true;
};
