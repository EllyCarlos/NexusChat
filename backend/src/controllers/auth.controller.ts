import { NextFunction, Response } from "express";
import { config } from "../config/env.config.js";
import type { AuthenticatedRequest, OAuthAuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import { prisma } from '../lib/prisma.lib.js';
import type { fcmTokenSchemaType } from "../schemas/auth.schema.js";
import { CustomError, asyncErrorHandler } from "../utils/error.utils.js";
import { signOAuthExchangeToken } from "../modules/auth/token/session-token.service.js";
import { logServerError } from "../utils/safe-logger.utils.js";

const getUserInfo = asyncErrorHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const user = req.user;
  if (!user) {
    return next(new CustomError("User not found in request context", 404));
  }

  const secureUserInfo = {
    id: user.id,
    name: user.name,
    username: user.username,
    avatar: user.avatar,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    emailVerified: user.emailVerified,
    publicKey: user.publicKey,
    // --- ADDED: Include needsKeyRecovery and keyRecoveryCompletedAt ---
    needsKeyRecovery: user.needsKeyRecovery,
    keyRecoveryCompletedAt: user.keyRecoveryCompletedAt,
    notificationsEnabled: user.notificationsEnabled,
    verificationBadge: user.verificationBadge,
    fcmToken: user.fcmToken,
    oAuthSignup: user.oAuthSignup
  };
  return res.status(200).json(secureUserInfo);
});

const updateFcmToken = asyncErrorHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { fcmToken }: fcmTokenSchemaType = req.body;
  if (!fcmToken) {
    return next(new CustomError("FCM token is required", 400));
  }

  const user = await prisma.user.update({
    where: {
      id: req.user.id
    },
    data: {
      fcmToken
    }
  });
  return res.status(200).json({ fcmToken: user.fcmToken });
});

const checkAuth = asyncErrorHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (req.user) {
    const secureUserInfo = {
      id: req.user.id,
      name: req.user.name,
      username: req.user.username,
      avatar: req.user.avatar,
      email: req.user.email,
      createdAt: req.user.createdAt,
      updatedAt: req.user.updatedAt,
      emailVerified: req.user.emailVerified,
      publicKey: req.user.publicKey,
      // --- ADDED: Include needsKeyRecovery and keyRecoveryCompletedAt ---
      needsKeyRecovery: req.user.needsKeyRecovery,
      keyRecoveryCompletedAt: req.user.keyRecoveryCompletedAt,
      notificationsEnabled: req.user.notificationsEnabled,
      verificationBadge: req.user.verificationBadge,
      fcmToken: req.user.fcmToken,
      oAuthSignup: req.user.oAuthSignup
    };
    return res.status(200).json(secureUserInfo);
  }
  return next(new CustomError("Token missing, please login again", 401));
});

// Enhanced OAuth redirect handler
const redirectHandler = asyncErrorHandler(async (req: OAuthAuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user) {
      const userId = String(req.user.id);
      const isNewUser = Boolean(req.user.newUser);

      // Create temporary OAuth token (5 minutes expiry)
      const tempToken = signOAuthExchangeToken({
        userId,
        isNewUser,
        email: req.user.email,
      });

      console.log('OAuth redirect issued.');
      return res.redirect(
        307,
        `${config.app.clientUrl}/auth/oauth-redirect#token=${encodeURIComponent(tempToken)}`
      );
    }

    console.warn('OAuth callback did not produce a user.');
    return res.redirect(307, `${config.app.clientUrl}/auth/oauth-redirect?error=no_user_data`);
  } catch {
    console.error('OAuth redirect failed.');
    return res.redirect(307, `${config.app.clientUrl}/auth/oauth-redirect?error=oauth_failed`);
  }
});

// --- NEW: Private Key Recovery Completion Endpoint ---
const completeKeyRecovery = asyncErrorHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user.id; // User ID from authenticated request

    if (!userId) {
      return next(new CustomError("User ID missing from authenticated request", 400));
    }

    // Update the user's needsKeyRecovery and keyRecoveryCompletedAt fields
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        needsKeyRecovery: false,
        keyRecoveryCompletedAt: new Date(), // Set current timestamp
      },
      select: {
        id: true,
        needsKeyRecovery: true,
        keyRecoveryCompletedAt: true,
      },
    });

    console.log("Private key recovery marked as complete.");
    return res.status(200).json({
      success: true,
      message: "Private key recovery status updated successfully.",
      user: {
        id: updatedUser.id,
        needsKeyRecovery: updatedUser.needsKeyRecovery,
        keyRecoveryCompletedAt: updatedUser.keyRecoveryCompletedAt,
      },
    });
  } catch (error) {
    logServerError("Private key recovery completion failed.", error);
    return next(new CustomError("Failed to complete private key recovery.", 500));
  }
});


const logoutHandler = asyncErrorHandler(async (req: AuthenticatedRequest, res: Response) => {
  // Changed cookie name from 'sessionToken' to 'session'
  res.clearCookie('session', {
    httpOnly: true,
    secure: config.app.environment === 'production',
    path: '/',
    domain: config.app.environment === 'production' ? config.app.cookieDomain : undefined,
    partitioned: true // For CHIPS
  });

  return res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
});

export {
  checkAuth,
  getUserInfo,
  redirectHandler,
  updateFcmToken,
  logoutHandler,
  completeKeyRecovery // Export the new function
};
