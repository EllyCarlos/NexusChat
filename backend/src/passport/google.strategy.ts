import bcrypt from "bcryptjs";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { DEFAULT_AVATAR } from "../constants/file.constant.js";
import type { RuntimeConfig } from "../interfaces/config/config.interface.js";
import { prisma } from "../lib/prisma.lib.js";

let isRegistered = false;

export const registerGoogleStrategy = (
  configuration: Pick<RuntimeConfig, "oauth">,
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
        const isExistingUser = await prisma.user.findUnique({
          where: { email: profile.emails[0].value },
        });

        if (isExistingUser) {
          done(null, {
            id: isExistingUser.id,
            username: isExistingUser.username,
            name: isExistingUser.name,
            avatar: isExistingUser.avatar,
            email: isExistingUser.email,
            emailVerified: isExistingUser.emailVerified,
            newUser: false,
            googleId: profile.id,
          });
          return;
        }

        let avatarUrl = DEFAULT_AVATAR;
        if (profile.photos && profile.photos[0].value) {
          avatarUrl = profile.photos[0].value;
        }
        const newUser = await prisma.user.create({
          data: {
            username: profile.displayName,
            name: profile.name?.givenName!,
            avatar: avatarUrl,
            email: profile.emails[0].value,
            hashedPassword: await bcrypt.hash(profile.id, 10),
            emailVerified: true,
            oAuthSignup: true,
            googleId: profile.id,
          },
          select: {
            id: true,
            username: true,
            name: true,
            avatar: true,
            email: true,
            emailVerified: true,
            googleId: true,
          },
        });
        done(null, { ...newUser, newUser: true });
        return;
      }
      throw new Error("Some Error occured");
    } catch {
      console.error("Google OAuth profile processing failed.");
      done(null, false);
    }
  }));
  isRegistered = true;
};
