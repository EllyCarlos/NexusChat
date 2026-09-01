import { NextFunction, Response } from "express";
import { config } from "../config/env.config.js";
import type { AuthenticatedRequest, OAuthAuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import { getCurrentUser } from "../modules/users/application/get-current-user.js";
import {
  completeUserKeyRecovery,
  updateNotificationToken,
} from "../modules/users/user-state.service.js";
import type { fcmTokenSchemaType } from "../schemas/auth.schema.js";
import { CustomError, asyncErrorHandler } from "../utils/error.utils.js";
import { signOAuthExchangeToken } from "../modules/auth/token/session-token.service.js";
import { getRequestLogger } from "../observability/request-logger.js";
import { logSafeError } from "../observability/safe-error.js";

const getUserInfo = asyncErrorHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const user = getCurrentUser(req.user);
  if (!user) {
    return next(new CustomError("User not found in request context", 404));
  }
  return res.status(200).json(user);
});

const updateFcmToken = asyncErrorHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { fcmToken }: fcmTokenSchemaType = req.body;
  if (!fcmToken) {
    return next(new CustomError("FCM token is required", 400));
  }

  const user = await updateNotificationToken({
    userId: req.user.id,
    fcmToken,
  });
  return res.status(200).json({ fcmToken: user.fcmToken });
});

const checkAuth = asyncErrorHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const user = getCurrentUser(req.user);
  if (user) {
    return res.status(200).json(user);
  }
  return next(new CustomError("Token missing, please login again", 401));
});

// Enhanced OAuth redirect handler
const redirectHandler = asyncErrorHandler(async (req: OAuthAuthenticatedRequest, res: Response, next: NextFunction) => {
  const logger = getRequestLogger(req, "auth");
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

      logger.info("auth.oauth_redirect.completed", { result: "completed" });
      return res.redirect(
        307,
        `${config.app.clientUrl}/auth/oauth-redirect#token=${encodeURIComponent(tempToken)}`
      );
    }

    logger.warn("auth.oauth_callback.rejected", { result: "rejected" });
    return res.redirect(307, `${config.app.clientUrl}/auth/oauth-redirect?error=no_user_data`);
  } catch (error) {
    logSafeError(logger, "auth.oauth_redirect.failed", error);
    return res.redirect(307, `${config.app.clientUrl}/auth/oauth-redirect?error=oauth_failed`);
  }
});

// --- NEW: Private Key Recovery Completion Endpoint ---
const completeKeyRecovery = asyncErrorHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const logger = getRequestLogger(req, "auth");
  try {
    const userId = req.user.id; // User ID from authenticated request

    if (!userId) {
      return next(new CustomError("User ID missing from authenticated request", 400));
    }

    const updatedUser = await completeUserKeyRecovery({
      userId,
    });

    logger.info("auth.key_recovery.completed", { result: "completed" });
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
    logSafeError(logger, "auth.key_recovery.failed", error);
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
