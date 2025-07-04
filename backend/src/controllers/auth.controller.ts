import { NextFunction, Request, Response } from "express";
import jwt from 'jsonwebtoken';
import { v4 as uuidV4 } from 'uuid'; // Added for JTI
import { config } from "../config/env.config.js";
import type { AuthenticatedRequest, OAuthAuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import { prisma } from '../lib/prisma.lib.js';
import type { fcmTokenSchemaType } from "../schemas/auth.schema.js";
import { env } from "../schemas/env.schema.js";
import { CustomError, asyncErrorHandler } from "../utils/error.utils.js";

// Cookie configuration utility
const setAuthCookie = (res: Response, token: string) => {
  const isProduction = process.env.NODE_ENV === 'production';
  // Changed cookie name from 'token' to 'session' for consistency with Next.js frontend
  res.cookie('session', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax', // 'none' requires secure: true
    // domain: isProduction ? config.cookieDomain : undefined, // Uncomment if you need a specific domain
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
    partitioned: true // For Chrome's new cookie partitioning (CHIPS)
  });
};

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

// Generate session token
const generateSessionToken = (userId: string) => {
  return jwt.sign({
    userId: userId,
    type: 'session',
    iat: Math.floor(Date.now() / 1000),
    iss: config.jwtIssuer,
    aud: config.jwtAudience,
    jti: uuidV4()
  }, env.JWT_SECRET, {
    expiresIn: "7d", // Matches cookie expiry
    algorithm: 'HS256'
  });
};

// Enhanced OAuth redirect handler
const redirectHandler = asyncErrorHandler(async (req: OAuthAuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user) {
      console.log('🔄 OAuth redirect - Processing user:', {
        userId: req.user.id,
        email: req.user.email,
        isNewUser: req.user.newUser
      });

      const userId = String(req.user.id);
      const isNewUser = Boolean(req.user.newUser);

      // Create temporary OAuth token (5 minutes expiry)
      const oauthTokenPayload = {
        userId: userId,
        isNewUser: isNewUser,
        type: 'oauth-temp',
        email: req.user.email, // Include email for additional validation
        iat: Math.floor(Date.now() / 1000)
      };

      const tempToken = jwt.sign(oauthTokenPayload, env.JWT_SECRET, {
        expiresIn: "5m",
        algorithm: 'HS256'
      });

      console.log('✅ OAuth token created successfully');

      const redirectUrl = `${config.clientUrl}/auth/oauth-redirect?token=${tempToken}`;
      console.log('🔗 Redirecting to:', redirectUrl);

      return res.redirect(307, redirectUrl);
    }

    console.warn('❌ No user data in OAuth request for redirect.'); // Changed to warn
    return res.redirect(307, `${config.clientUrl}/auth/oauth-redirect?error=no_user_data`);
  } catch (error) {
    console.error('🚨 OAuth redirect error:', error); // Use console.error
    return res.redirect(307, `${config.clientUrl}/auth/oauth-redirect?error=oauth_failed`);
  }
});

// Enhanced OAuth token verification endpoint
const verifyOAuthToken = asyncErrorHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.body;

    if (!token) {
      return next(new CustomError("OAuth token is required", 400));
    }

    console.log('🔍 Verifying OAuth token...');

    // Verify JWT token
    const decoded = jwt.verify(token, env.JWT_SECRET) as any;

    console.log('✅ JWT verification successful:', {
      userId: decoded.userId,
      isNewUser: decoded.isNewUser,
      type: decoded.type,
      email: decoded.email
    });

    // Validate token structure
    if (!decoded.userId || typeof decoded.isNewUser !== 'boolean' || decoded.type !== 'oauth-temp') {
      console.error('❌ Invalid token structure:', decoded);
      return next(new CustomError("Invalid OAuth token structure", 401));
    }

    // Find user in database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true,
        email: true,
        createdAt: true,
        updatedAt: true,
        emailVerified: true,
        publicKey: true,
        needsKeyRecovery: true, // Select this field
        keyRecoveryCompletedAt: true, // Select this field
        notificationsEnabled: true,
        verificationBadge: true,
        fcmToken: true,
        oAuthSignup: true,
        googleId: true // Ensure googleId is selected for combinedSecret
      }
    });

    if (!user) {
      console.error('❌ User not found:', decoded.userId);
      return next(new CustomError("User not found", 404));
    }

    console.log('✅ User found:', user.email);

    // Generate long-term session token
    const sessionToken = generateSessionToken(user.id);

    // Set HTTP-only cookie
    setAuthCookie(res, sessionToken);

    // Prepare response
    const responseData: any = {
      success: true,
      user: user, // Pass the full user object including new fields
      sessionToken: sessionToken,
      isNewUser: decoded.isNewUser
    };

    // Add combined secret for new users (for initial key generation/encryption)
    // IMPORTANT: Ensure PRIVATE_KEY_RECOVERY_SECRET is set in your backend environment variables
    if (decoded.isNewUser && user.oAuthSignup && user.googleId && process.env.PRIVATE_KEY_RECOVERY_SECRET) {
      responseData.combinedSecret = user.googleId + process.env.PRIVATE_KEY_RECOVERY_SECRET;
      console.log('🆕 New OAuth user - added combined secret for initial key generation/encryption');
    } else if (decoded.isNewUser && user.oAuthSignup && (!user.googleId || !process.env.PRIVATE_KEY_RECOVERY_SECRET)) {
        console.error("OAuth user missing googleId or PRIVATE_KEY_RECOVERY_SECRET for combined secret generation.");
        // Consider returning an error or handling this gracefully if it's a critical setup issue.
    }


    console.log('✅ OAuth verification complete for:', user.email);
    return res.status(200).json(responseData);

  } catch (error) {
    console.error('🚨 OAuth token verification failed:', error); // Use console.error

    if (error instanceof jwt.JsonWebTokenError) {
      return next(new CustomError("Invalid OAuth token", 401));
    }
    if (error instanceof jwt.TokenExpiredError) {
      return next(new CustomError("OAuth token expired", 401));
    }

    return next(new CustomError("OAuth verification failed", 500));
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

    console.log(`✅ User ${userId} private key recovery marked as complete.`);
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
    console.error("🚨 Error completing private key recovery:", error);
    return next(new CustomError("Failed to complete private key recovery.", 500));
  }
});


const logoutHandler = asyncErrorHandler(async (req: AuthenticatedRequest, res: Response) => {
  // Changed cookie name from 'sessionToken' to 'session'
  res.clearCookie('session', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    domain: process.env.NODE_ENV === 'production' ? config.cookieDomain : undefined,
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
  verifyOAuthToken,
  logoutHandler,
  generateSessionToken,
  completeKeyRecovery // Export the new function
};