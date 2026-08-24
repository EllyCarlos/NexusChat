"use server";

import { DEFAULT_AVATAR } from "@/constants";
import { sendEmail } from "@/lib/server/email/SendEmail";
import {
  decryptPrivateKeyV2,
  parsePrivateKeyBackup,
  parsePrivateKeyEnvelopeV2,
  validateNexusChatPublicJsonWebKey,
  type RecoveryKeyWrapV2,
} from "@/lib/client/privateKeyEnvelope";
import { generateOtp } from "@/lib/server/helpers";
import {
  generatePerUserRecoverySecret,
  PrivateKeyRecoveryKeyWrapError,
  unwrapRecoverySecret,
  wrapRecoverySecret,
} from "@/lib/server/privateKeyRecoveryKeyWrap";
import { prisma } from "@/lib/server/prisma";
import { getAuthenticatedSession } from "@/lib/server/authenticatedSession";
import {
  checkServerActionRateLimit,
  consumeServerActionRateLimit,
  normalizeAccountIdentifier,
  RATE_LIMIT_MESSAGE,
  resetServerActionRateLimit,
  type RateLimitDecision,
  type RateLimitPolicy,
} from "@/lib/server/rateLimit";
import {
  createSession,
  deleteSession,
  signPasswordResetToken,
  signPrivateKeyRecoveryToken,
  verifyOAuthExchangeToken,
  verifyPasswordResetToken,
  verifyPrivateKeyRecoveryToken as verifyPrivateKeyRecoveryJwt,
} from "@/lib/server/session";
import bcrypt from "bcryptjs";

const PRIVATE_KEY_RECOVERY_TOKEN_VALIDITY_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const RATE_LIMITS = {
  login: { namespace: "login", limit: 5, windowMs: 10 * MINUTE_MS },
  signup: { namespace: "signup", limit: 3, windowMs: HOUR_MS },
  forgotPassword: { namespace: "forgot-password", limit: 3, windowMs: HOUR_MS },
  resetPassword: { namespace: "reset-password", limit: 5, windowMs: 15 * MINUTE_MS },
  otpSendCooldown: { namespace: "otp-send-cooldown", limit: 1, windowMs: MINUTE_MS },
  otpSendWindow: { namespace: "otp-send-window", limit: 5, windowMs: HOUR_MS },
  otpVerify: { namespace: "otp-verify", limit: 5, windowMs: 10 * MINUTE_MS },
  verifyPassword: { namespace: "verify-password", limit: 5, windowMs: 10 * MINUTE_MS },
  recoveryEmailCooldown: { namespace: "recovery-email-cooldown", limit: 1, windowMs: MINUTE_MS },
  recoveryEmailWindow: { namespace: "recovery-email-window", limit: 3, windowMs: HOUR_MS },
  recoveryToken: { namespace: "recovery-token", limit: 5, windowMs: 15 * MINUTE_MS },
  oauthExchange: { namespace: "oauth-exchange", limit: 10, windowMs: 10 * MINUTE_MS },
} satisfies Record<string, RateLimitPolicy>;

const consumeLayeredLimit = (
  key: string,
  first: RateLimitPolicy,
  second: RateLimitPolicy,
): RateLimitDecision => {
  const firstDecision = consumeServerActionRateLimit(first, key);
  return firstDecision.allowed ? consumeServerActionRateLimit(second, key) : firstDecision;
};

const checkLayeredLimit = (
  key: string,
  first: RateLimitPolicy,
  second: RateLimitPolicy,
): RateLimitDecision => {
  const firstDecision = checkServerActionRateLimit(first, key);
  return firstDecision.allowed ? checkServerActionRateLimit(second, key) : firstDecision;
};

type OAuthV2SetupMaterial = {
  version: 2;
  recoverySecret: string;
  recoveryKeyWrap: RecoveryKeyWrapV2;
};

type OAuthV2MigrationMaterial = OAuthV2SetupMaterial & {
  publicKey: JsonWebKey;
};

const parseStoredNexusChatPublicKey = async (serializedPublicKey: string) => {
  let parsedPublicKey: unknown;
  try {
    parsedPublicKey = JSON.parse(serializedPublicKey) as unknown;
  } catch {
    throw new Error("Stored public key is invalid.");
  }

  return validateNexusChatPublicJsonWebKey(parsedPublicKey);
};

const createOAuthV2MigrationMaterial = async ({
  userId,
  serializedPublicKey,
}: {
  userId: string;
  serializedPublicKey: string;
}): Promise<OAuthV2MigrationMaterial> => {
  const publicKey = await parseStoredNexusChatPublicKey(serializedPublicKey);
  const recoverySecret = generatePerUserRecoverySecret();

  return {
    version: 2,
    recoverySecret,
    recoveryKeyWrap: wrapRecoverySecret({ userId, recoverySecret }),
    publicKey,
  };
};

export type PrivateKeyRecoveryData =
  | {
      userId: string;
      privateKey: string;
      recoveryMode: "manual-v1";
    }
  | {
      userId: string;
      privateKey: string;
      recoveryMode: "oauth-v1";
      combinedSecret: string;
    }
  | {
      userId: string;
      privateKey: string;
      recoveryMode: "oauth-v2";
      recoverySecret: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function issuePrivateKeyRecoveryToken(userId: string) {
  const expiresAt = new Date(Date.now() + PRIVATE_KEY_RECOVERY_TOKEN_VALIDITY_MS);
  const recoveryToken = await signPrivateKeyRecoveryToken({ userId, expiresAt });
  const hashedToken = await bcrypt.hash(recoveryToken, 10);

  await prisma.privateKeyRecoveryToken.deleteMany({ where: { userId } });
  await prisma.privateKeyRecoveryToken.create({
    data: { userId, hashedToken, expiresAt }
  });

  return recoveryToken;
}

// --- LOGIN ---
export async function login(prevState: any, formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  try {
    if (!email || !password) {
      return {
        errors: {
          message: "Email and password are required.", // More specific message
        },
        redirect: false
      };
    }

    const normalizedEmail = normalizeAccountIdentifier(email);
    if (!consumeServerActionRateLimit(RATE_LIMITS.login, normalizedEmail).allowed) {
      return {
        errors: { message: RATE_LIMIT_MESSAGE },
        redirect: false,
      };
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Generic error message for security (don't reveal if user exists)
      return {
        errors: {
          message: "Invalid credentials.",
        },
        redirect: false,
      };
    }

    if (await bcrypt.compare(password, user.hashedPassword)) {
      await createSession(user.id);
      return {
        errors: {
          message: null,
        },
        redirect: true,
      };
    } else {
      return {
        errors: {
          message: "Invalid credentials.", // Generic error for wrong password
        },
        redirect: false,
      };
    }
  } catch (error) {
    console.error("Login error:", error); // Use console.error for actual errors
    return {
      errors: {
        message: "An unexpected error occurred during login.",
      },
      redirect: false,
    };
  }
}

// --- SIGNUP ---
export async function signup(prevState: any, formData: FormData) {
  const username = formData.get("username") as string;
  const password = formData.get("password") as string;
  const email = formData.get("email") as string;
  const name = formData.get("name") as string;

  if (!username || !password || !email || !name) {
    return {
      errors: {
        message: "All fields are required.",
      },
    };
  }

  const normalizedEmail = normalizeAccountIdentifier(email);
  if (!consumeServerActionRateLimit(RATE_LIMITS.signup, normalizedEmail).allowed) {
    return { errors: { message: RATE_LIMIT_MESSAGE } };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (user) {
      return {
        errors: {
          message: "User with this email already exists.",
        },
      };
    }

    const existingUsername = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUsername) {
      return {
        errors: {
          message: "Username is already taken.",
        },
      };
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        email,
        hashedPassword,
        username,
        avatar: DEFAULT_AVATAR,
        name,
      },
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
        notificationsEnabled: true,
        verificationBadge: true,
        fcmToken: true,
        oAuthSignup: true,
      },
    });

    await createSession(newUser.id); // Create session for the new user

    return {
      errors: null,
      data: newUser
    };
  } catch (error) {
    console.error("Signup error:", error);
    return {
      errors: {
        message: "An unexpected error occurred during signup.",
      },
    };
  }
}

// --- LOGOUT ---
export async function logout() {
  await deleteSession();
}

// --- SEND PRIVATE KEY RECOVERY EMAIL ---
export async function sendPrivateKeyRecoveryEmail(_prevState: unknown) {
  void _prevState;

  try {
    const session = await getAuthenticatedSession();
    if (!session) {
      return {
        errors: { message: "User session not found. Please log in again." },
        success: { message: null }
      };
    }

    const recoveryEmailDecision = consumeLayeredLimit(
      session.userId,
      RATE_LIMITS.recoveryEmailCooldown,
      RATE_LIMITS.recoveryEmailWindow,
    );
    if (!recoveryEmailDecision.allowed) {
      return {
        errors: { message: RATE_LIMIT_MESSAGE },
        success: { message: null }
      };
    }

    const recoveryUser = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, email: true, username: true, oAuthSignup: true }
    });

    if (!recoveryUser?.oAuthSignup || !recoveryUser.email || !recoveryUser.username) {
      return {
        errors: { message: "User information is incomplete." },
        success: { message: null }
      };
    }

    const privateKeyRecoveryToken = await issuePrivateKeyRecoveryToken(recoveryUser.id);
    const privateKeyRecoveryUrl = `${process.env.NEXT_PUBLIC_CLIENT_URL}/auth/private-key-recovery-token-verification?token=${privateKeyRecoveryToken}`;

    await sendEmail({ emailType: "privateKeyRecovery", to: recoveryUser.email, username: recoveryUser.username, verificationUrl: privateKeyRecoveryUrl });

    return {
      errors: {
        message: null
      },
      success: {
        message: "Private key recovery email sent successfully. Please check your inbox (and spam folder)."
      }
    };
  } catch (error) {
    console.error('Error sending private key recovery email:', error);
    return {
      errors: {
        message: "Error sending private key recovery email. Please try again later."
      },
      success: {
        message: null
      }
    };
  }
}

// --- VERIFY PRIVATE KEY RECOVERY TOKEN ---
export async function verifyPrivateKeyRecoveryToken(_prevState: unknown, data: { recoveryToken: string }) {
  try {
    if (!data.recoveryToken) {
      return {
        errors: { message: 'Invalid request: Token missing.' },
        data: null
      };
    }

    const decodedPayload = await verifyPrivateKeyRecoveryJwt(data.recoveryToken);
    if (!decodedPayload) {
      return {
        errors: {
          message: 'Verification link is invalid or expired. Please request a new one.'
        },
        data: null
      };
    }
    const tokenUserId = decodedPayload.userId;
    const tokenExpiresAt = new Date(decodedPayload.expiresAt);

    if (!tokenUserId || Number.isNaN(tokenExpiresAt.getTime()) || tokenExpiresAt <= new Date()) {
      return {
        errors: {
          message: 'Verification link is invalid or expired. Please request a new one.'
        },
        data: null
      };
    }

    if (!consumeServerActionRateLimit(RATE_LIMITS.recoveryToken, tokenUserId).allowed) {
      return {
        errors: { message: RATE_LIMIT_MESSAGE },
        data: null
      };
    }

    const recoveryTokenExists = await prisma.privateKeyRecoveryToken.findFirst({
      where: { userId: tokenUserId }
    });

    if (!recoveryTokenExists) {
      return {
        errors: {
          message: 'Verification link is invalid or already used.'
        },
        data: null
      };
    }

    if (recoveryTokenExists.expiresAt <= new Date()) {
      await prisma.privateKeyRecoveryToken.delete({ where: { id: recoveryTokenExists.id } });
      return {
        errors: {
          message: 'Verification link has expired. Please request a new one.'
        },
        data: null
      };
    }

    if (!(await bcrypt.compare(data.recoveryToken, recoveryTokenExists.hashedToken))) {
      return {
        errors: {
          message: 'Verification link is invalid. Please ensure the full link is used.'
        },
        data: null
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: tokenUserId },
      select: { id: true, privateKey: true, oAuthSignup: true, googleId: true }
    });

    if (!user) {
      return {
        errors: {
          message: 'User not found. Verification link is not valid.'
        },
        data: null
      };
    }

    if (!user.privateKey) {
      return {
        errors: {
          message: 'No private key found for this user account.'
        },
        data: null
      };
    }

    const parsedBackup = parsePrivateKeyBackup(user.privateKey);
    let payload: PrivateKeyRecoveryData;

    if (!user.oAuthSignup) {
      if (parsedBackup.format !== "legacy-v1") {
        return {
          errors: { message: "Private-key recovery failed." },
          data: null
        };
      }
      payload = {
        userId: user.id,
        privateKey: user.privateKey,
        recoveryMode: "manual-v1"
      };
    } else if (parsedBackup.format === "legacy-v1") {
      if (!user.googleId || !process.env.PRIVATE_KEY_RECOVERY_SECRET) {
        return {
          errors: { message: "Private-key recovery failed." },
          data: null
        };
      }
      payload = {
        userId: user.id,
        privateKey: user.privateKey,
        recoveryMode: "oauth-v1",
        combinedSecret: user.googleId + process.env.PRIVATE_KEY_RECOVERY_SECRET
      };
    } else {
      const recoverySecret = unwrapRecoverySecret({
        userId: tokenUserId,
        recoveryKeyWrap: parsedBackup.envelope.recoveryKeyWrap
      });
      payload = {
        userId: user.id,
        privateKey: user.privateKey,
        recoveryMode: "oauth-v2",
        recoverySecret
      };
    }

    await prisma.privateKeyRecoveryToken.delete({ where: { id: recoveryTokenExists.id } });
    await createSession(user.id);
    resetServerActionRateLimit(RATE_LIMITS.recoveryToken, tokenUserId);

    return {
      errors: {
        message: null
      },
      data: payload
    };

  } catch {
    console.error('Private-key recovery token verification failed.');
    // Be careful with error messages to avoid leaking information
    return {
      errors: {
        message: 'An error occurred during verification. Please try again.'
      },
      data: null
    };
  }
}

// --- VERIFY PASSWORD (for Private Key Recovery initial step) ---
export async function verifyPassword(_prevState: unknown, data: { password: string }) {
  try {
    const session = await getAuthenticatedSession();
    if (!session) {
      return {
        errors: { message: "Authentication is required." },
        success: { message: null }
      };
    }

    const { password } = data;

    if (!password) {
      return {
        errors: { message: "Password is required." },
        success: { message: null }
      };
    }

    if (!consumeServerActionRateLimit(RATE_LIMITS.verifyPassword, session.userId).allowed) {
      return {
        errors: { message: RATE_LIMIT_MESSAGE },
        success: { message: null }
      };
    }

    const recoveryEmailDecision = checkLayeredLimit(
      session.userId,
      RATE_LIMITS.recoveryEmailCooldown,
      RATE_LIMITS.recoveryEmailWindow,
    );
    if (!recoveryEmailDecision.allowed) {
      return {
        errors: { message: RATE_LIMIT_MESSAGE },
        success: { message: null }
      };
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });

    if (!user) {
      return {
        errors: {
          message: 'User not found.'
        },
        success: {
          message: null
        }
      };
    }

    // If user is OAuth signed up, they don't have a hashed password.
    // Instead, rely on the private key recovery email flow.
    if (user.oAuthSignup) {
        return {
            errors: {
                message: 'This account uses OAuth. Please use the "Forgot Private Key" link on the recovery page to send a recovery email.'
            },
            success: {
                message: null
            }
        };
    }

    if (!(await bcrypt.compare(password, user.hashedPassword))) {
      return {
        errors: {
          message: 'Invalid password. Please try again.'
        },
        success: {
          message: null
        }
      };
    }

    const consumedRecoveryEmail = consumeLayeredLimit(
      session.userId,
      RATE_LIMITS.recoveryEmailCooldown,
      RATE_LIMITS.recoveryEmailWindow,
    );
    if (!consumedRecoveryEmail.allowed) {
      return {
        errors: { message: RATE_LIMIT_MESSAGE },
        success: { message: null }
      };
    }
    resetServerActionRateLimit(RATE_LIMITS.verifyPassword, session.userId);

    const privateKeyRecoveryToken = await issuePrivateKeyRecoveryToken(session.userId);
    const privateKeyRecoveryUrl = `${process.env.NEXT_PUBLIC_CLIENT_URL}/auth/private-key-recovery-token-verification?token=${privateKeyRecoveryToken}`;
    await sendEmail({ emailType: "privateKeyRecovery", to: user.email, username: user.username, verificationUrl: privateKeyRecoveryUrl });

    return {
      errors: {
        message: null
      },
      success: {
        message: `A private key recovery link has been sent to your email address on file.`
      }
    };

  } catch (error) {
    console.error('Error verifying password for private key recovery:', error);
    return {
      errors: {
        message: 'An error occurred during password verification. Please try again.'
      },
      success: {
        message: null
      }
    };
  }
}

// --- FORGOT PASSWORD (for account password reset) ---
export async function forgotPassword(prevState: any, email: string) {
  try {
    if (!email) {
      return {
        errors: {
          message: "Email is required."
        },
        success: {
          message: null
        }
      };
    }

    const normalizedEmail = normalizeAccountIdentifier(email);
    if (!consumeServerActionRateLimit(RATE_LIMITS.forgotPassword, normalizedEmail).allowed) {
      return {
        errors: { message: RATE_LIMIT_MESSAGE },
        success: { message: null }
      };
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        username: true
      }
    });

    // Always return a success message for security, regardless if user exists
    if (!user) {
      return {
        errors: {
          message: null
        },
        success: {
          message: "If an account with that email exists, we've sent a password reset link."
        }
      };
    }

    const resetTokenExpiresAt = new Date(Date.now() + 1000 * 60 * 60);
    const resetPasswordToken = await signPasswordResetToken({
      userId: user.id,
      expiresAt: resetTokenExpiresAt
    });

    const hashedResetToken = await bcrypt.hash(resetPasswordToken, 10);

    await prisma.resetPasswordToken.deleteMany({
      where: { userId: user.id }
    });

    await prisma.resetPasswordToken.create({
      data: {
        userId: user.id,
        hashedToken: hashedResetToken,
        expiresAt: resetTokenExpiresAt
      }
    });

    const resetUrl = `${process.env.NEXT_PUBLIC_CLIENT_URL}/auth/reset-password?token=${resetPasswordToken}`;

    await sendEmail({
      emailType: "resetPassword",
      to: user.email,
      username: user.username,
      resetPasswordUrl: resetUrl
    });

    return {
      errors: {
        message: null
      },
      success: {
        message: "If an account with that email exists, we've sent a password reset link."
      }
    };

  } catch (error) {
    console.error('Error sending password reset email:', error);
    return {
      errors: {
        message: "Error sending password reset email."
      },
      success: {
        message: null
      }
    };
  }
}

// --- VERIFY OAUTH TOKEN ---
export async function verifyOAuthToken(_prevState: unknown, token: string) {
  try {
    if (!token) {
      return {
        errors: {
          message: "Token is required"
        },
        data: null
      };
    }

    console.log('🔍 Verifying OAuth token...');

    if (!process.env.JWT_SECRET) {
      console.error('❌ JWT_SECRET is not configured');
      return {
        errors: {
          message: "Server configuration error"
        },
        data: null
      };
    }

    const decoded = await verifyOAuthExchangeToken(token);

    if (!decoded) {
      return {
        errors: {
          message: "Invalid or expired OAuth exchange token"
        },
        data: null
      };
    }

    console.log('🔍 Decoded token structure:', {
      keys: Object.keys(decoded),
      userId: decoded.userId,
      isNewUser: decoded.isNewUser,
      tokenType: decoded.tokenType
    });

    if (!decoded.userId) {
      console.error('❌ Missing userId in token. Available fields:', Object.keys(decoded));
      return {
        errors: {
          message: "Invalid user identifier in token"
        },
        data: null
      };
    }

    // Ensure isNewUser is a boolean, as expected by client-side logic
    if (typeof decoded.isNewUser !== 'boolean') {
      console.error('❌ Invalid isNewUser type:', typeof decoded.isNewUser, 'Value:', decoded.isNewUser);
      return {
        errors: {
          message: "Invalid token structure"
        },
        data: null
      };
    }

    console.log('✅ Token validation passed:', {
      userId: decoded.userId,
      isNewUser: decoded.isNewUser
    });

    if (!consumeServerActionRateLimit(RATE_LIMITS.oauthExchange, decoded.userId).allowed) {
      return {
        errors: { message: RATE_LIMIT_MESSAGE },
        data: null
      };
    }

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
        notificationsEnabled: true,
        verificationBadge: true,
        fcmToken: true,
        oAuthSignup: true,
        privateKey: true,
      }
    });

    if (!user) {
      console.error('❌ User not found in database for ID:', decoded.userId);
      return {
        errors: {
          message: "User not found"
        },
        data: null
      };
    }

    console.log('✅ User found in database:', user.id);

    if (decoded.isNewUser && !user.oAuthSignup) {
      return {
        errors: { message: "OAuth account setup failed." },
        data: null
      };
    }

    if (
      user.oAuthSignup &&
      (user.privateKey === null) !== (user.publicKey === null)
    ) {
      return {
        errors: { message: "OAuth account setup failed." },
        data: null
      };
    }

    let oauthSetup: OAuthV2SetupMaterial | null = null;
    let oauthMigration: OAuthV2MigrationMaterial | null = null;
    let oauthMigrationError = false;
    if (
      user.oAuthSignup &&
      user.privateKey === null &&
      user.publicKey === null
    ) {
      const recoverySecret = generatePerUserRecoverySecret();
      oauthSetup = {
        version: 2,
        recoverySecret,
        recoveryKeyWrap: wrapRecoverySecret({
          userId: user.id,
          recoverySecret
        })
      };
    } else if (
      user.oAuthSignup &&
      user.privateKey !== null &&
      user.publicKey !== null
    ) {
      try {
        const currentBackup = parsePrivateKeyBackup(user.privateKey);
        if (currentBackup.format === "legacy-v1") {
          oauthMigration = await createOAuthV2MigrationMaterial({
            userId: user.id,
            serializedPublicKey: user.publicKey,
          });
        }
      } catch {
        oauthMigrationError = true;
      }
    }

    // Create and persist the real session that REST and Socket.IO will use.
    const sessionToken = await createSession(user.id);

    const clientUser = {
      id: user.id,
      name: user.name,
      username: user.username,
      avatar: user.avatar,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      emailVerified: user.emailVerified,
      publicKey: user.publicKey,
      notificationsEnabled: user.notificationsEnabled,
      verificationBadge: user.verificationBadge,
      fcmToken: user.fcmToken,
      oAuthSignup: user.oAuthSignup,
    };
    const responseData: {
      user: typeof clientUser;
      sessionToken: string;
      oauthSetup: OAuthV2SetupMaterial | null;
      oauthMigration: OAuthV2MigrationMaterial | null;
      oauthMigrationError: boolean;
    } = {
      user: clientUser,
      sessionToken,
      oauthSetup,
      oauthMigration,
      oauthMigrationError
    };

    console.log('✅ OAuth verification successful for user:', user.id);
    return {
      errors: {
        message: null
      },
      data: responseData
    };

  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TokenExpiredError') {
        return {
          errors: {
            message: "Token has expired. Please try logging in again."
          },
          data: null
        };
      }
      if (error.name === 'JsonWebTokenError') {
        return {
          errors: {
            message: "Invalid token format."
          },
          data: null
        };
      }
    }

    if (error instanceof PrivateKeyRecoveryKeyWrapError) {
      console.error("OAuth V2 recovery setup is unavailable.");
    } else {
      console.error("OAuth token verification failed.");
    }
    return {
      errors: {
        message: "OAuth account setup failed. Please try again."
      },
      data: null
    };
  }
}

// --- RESET PASSWORD ---
export async function resetPassword(prevState: any, data: { token: string, newPassword: string }) {
  try {
    const { newPassword, token } = data;

    if (!newPassword || !token) {
      return {
        errors: { message: 'New password and token are required.' },
        success: { message: null }
      };
    }

    const decodedPayload = await verifyPasswordResetToken(token);

    if (!decodedPayload || !decodedPayload.userId || new Date(decodedPayload.expiresAt) < new Date()) {
      return {
        errors: {
          message: 'Password reset link is invalid or has expired.'
        },
        success: {
          message: null
        }
      };
    }

    const userId = decodedPayload.userId;

    if (!consumeServerActionRateLimit(RATE_LIMITS.resetPassword, userId).allowed) {
      return {
        errors: { message: RATE_LIMIT_MESSAGE },
        success: { message: null }
      };
    }

    // Check database for the hashed token
    const resetPasswordTokenExists = await prisma.resetPasswordToken.findFirst({
      where: { userId }
    });

    if (!resetPasswordTokenExists) {
      return {
        errors: {
          message: 'Password reset link is invalid or already used.'
        },
        success: {
          message: null
        }
      };
    }

    // Compare the provided token with the hashed token from the DB
    if (!(await bcrypt.compare(token, resetPasswordTokenExists.hashedToken))) {
        return {
            errors: {
                message: 'Password reset link is invalid.'
            },
            success: {
                message: null
            }
        };
    }

    // Check DB record expiry (double-check against the token's internal expiry)
    if (resetPasswordTokenExists.expiresAt < new Date()) {
      await prisma.resetPasswordToken.delete({ where: { id: resetPasswordTokenExists.id } }); // Clean up expired token
      return {
        errors: {
          message: 'Password reset link has expired. Please request a new one.'
        },
        success: {
          message: null
        }
      };
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return {
        errors: {
          message: 'User not found.'
        },
        success: {
          message: null
        }
      };
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { hashedPassword: await bcrypt.hash(newPassword, 10) }
    });

    await prisma.resetPasswordToken.delete({ where: { id: resetPasswordTokenExists.id } }); // Delete used token
    resetServerActionRateLimit(RATE_LIMITS.resetPassword, userId);

    return {
      errors: {
        message: null
      },
      success: {
        message: `Dear ${user.username}, your password has been reset successfully.`
      }
    };

  } catch (error) {
    console.error('Error resetting password:', error);
    return {
      errors: {
        message: 'An error occurred during password reset. Please try again.'
      },
      success: {
        message: null
      }
    };
  }
}

// --- PROVISION NEW OAUTH V2 USER KEYS ---
export async function storeNewOAuthV2UserKeys(
  _prevState: unknown,
  data: { publicKey: unknown; privateKey: string }
) {
  try {
    if (!data || typeof data.privateKey !== "string" || !data.publicKey) {
      return {
        errors: { message: "Key provisioning failed." },
        success: { message: null },
        data: null
      };
    }

    const session = await getAuthenticatedSession();
    if (!session) {
      return {
        errors: { message: "Authentication is required." },
        success: { message: null },
        data: null
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        oAuthSignup: true,
        privateKey: true,
        publicKey: true
      }
    });
    if (!user?.oAuthSignup) {
      return {
        errors: { message: "Key provisioning failed." },
        success: { message: null },
        data: null
      };
    }

    const envelope = parsePrivateKeyEnvelopeV2(data.privateKey);
    const validatedPublicKey = await validateNexusChatPublicJsonWebKey(
      data.publicKey
    );
    const serializedPublicKey = JSON.stringify(validatedPublicKey);

    unwrapRecoverySecret({
      userId: session.userId,
      recoveryKeyWrap: envelope.recoveryKeyWrap
    });

    if (user.privateKey !== null || user.publicKey !== null) {
      if (
        user.privateKey === data.privateKey &&
        user.publicKey === serializedPublicKey
      ) {
        return {
          errors: { message: null },
          success: { message: "User keys are already provisioned." },
          data: { publicKey: user.publicKey }
        };
      }
      return {
        errors: { message: "User keys are already provisioned." },
        success: { message: null },
        data: null
      };
    }

    const updateResult = await prisma.user.updateMany({
      where: {
        id: session.userId,
        privateKey: null,
        publicKey: null
      },
      data: {
        privateKey: data.privateKey,
        publicKey: serializedPublicKey
      }
    });

    if (updateResult.count === 0) {
      const provisionedUser = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { privateKey: true, publicKey: true }
      });
      if (
        provisionedUser?.privateKey !== data.privateKey ||
        provisionedUser.publicKey !== serializedPublicKey
      ) {
        return {
          errors: { message: "User keys are already provisioned." },
          success: { message: null },
          data: null
        };
      }
    }

    return {
      errors: { message: null },
      success: { message: "User keys stored successfully." },
      data: { publicKey: serializedPublicKey }
    };
  } catch {
    console.error("OAuth V2 key provisioning failed.");
    return {
      errors: { message: "Key provisioning failed." },
      success: { message: null },
      data: null
    };
  }
}

// --- PREPARE POST-RECOVERY OAUTH LEGACY BACKUP MIGRATION ---
export async function prepareOAuthPrivateKeyBackupV2Migration(
  _prevState: unknown
) {
  void _prevState;

  try {
    const session = await getAuthenticatedSession();
    if (!session) {
      return {
        errors: { message: "Private-key backup migration was not completed." },
        data: null
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        oAuthSignup: true,
        privateKey: true,
        publicKey: true
      }
    });
    if (!user?.oAuthSignup || !user.privateKey || !user.publicKey) {
      return {
        errors: { message: "Private-key backup migration was not completed." },
        data: null
      };
    }

    const currentBackup = parsePrivateKeyBackup(user.privateKey);
    if (currentBackup.format !== "legacy-v1") {
      return {
        errors: { message: null },
        data: null
      };
    }

    const migration = await createOAuthV2MigrationMaterial({
      userId: session.userId,
      serializedPublicKey: user.publicKey,
    });

    return {
      errors: { message: null },
      data: migration
    };
  } catch {
    console.error("OAuth private-key backup migration preparation failed.");
    return {
      errors: { message: "Private-key backup migration was not completed." },
      data: null
    };
  }
}

// --- MIGRATE EXISTING OAUTH LEGACY PRIVATE-KEY BACKUP TO V2 ---
export async function migrateOAuthPrivateKeyBackupToV2(
  _prevState: unknown,
  data: unknown
) {
  try {
    if (
      !isRecord(data) ||
      Object.keys(data).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(data, "privateKey") ||
      typeof data.privateKey !== "string" ||
      !data.privateKey
    ) {
      return {
        errors: { message: "Private-key backup migration was not completed." },
        success: { message: null },
        data: null
      };
    }

    const session = await getAuthenticatedSession();
    if (!session) {
      return {
        errors: { message: "Authentication is required." },
        success: { message: null },
        data: null
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        oAuthSignup: true,
        privateKey: true,
        publicKey: true
      }
    });
    if (!user?.oAuthSignup || !user.privateKey || !user.publicKey) {
      return {
        errors: { message: "Private-key backup migration was not completed." },
        success: { message: null },
        data: null
      };
    }

    const envelope = parsePrivateKeyEnvelopeV2(data.privateKey);
    const recoverySecret = unwrapRecoverySecret({
      userId: session.userId,
      recoveryKeyWrap: envelope.recoveryKeyWrap
    });
    const [privateKey, publicKey] = await Promise.all([
      decryptPrivateKeyV2({ envelope, recoverySecret }),
      parseStoredNexusChatPublicKey(user.publicKey)
    ]);

    if (
      privateKey.kty !== publicKey.kty ||
      privateKey.crv !== publicKey.crv ||
      privateKey.x !== publicKey.x ||
      privateKey.y !== publicKey.y
    ) {
      return {
        errors: { message: "Private-key backup migration was not completed." },
        success: { message: null },
        data: null
      };
    }

    if (user.privateKey === data.privateKey) {
      return {
        errors: { message: null },
        success: { message: "Private-key backup is already migrated." },
        data: { migrated: true }
      };
    }

    const currentBackup = parsePrivateKeyBackup(user.privateKey);
    if (currentBackup.format !== "legacy-v1") {
      return {
        errors: { message: "Private-key backup migration was not completed." },
        success: { message: null },
        data: null
      };
    }

    const updateResult = await prisma.user.updateMany({
      where: {
        id: session.userId,
        privateKey: user.privateKey
      },
      data: {
        privateKey: data.privateKey
      }
    });

    if (updateResult.count === 0) {
      const currentUser = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { privateKey: true }
      });
      if (currentUser?.privateKey !== data.privateKey) {
        return {
          errors: { message: "Private-key backup migration was not completed." },
          success: { message: null },
          data: null
        };
      }
    }

    return {
      errors: { message: null },
      success: { message: "Private-key backup migrated successfully." },
      data: { migrated: true }
    };
  } catch {
    console.error("OAuth private-key backup migration failed.");
    return {
      errors: { message: "Private-key backup migration was not completed." },
      success: { message: null },
      data: null
    };
  }
}

// --- STORE MANUAL-SIGNUP LEGACY USER KEYS ---
export async function storeUserKeysInDatabase(
  _prevState: unknown,
  data: {
    publicKey: JsonWebKey;
    privateKey: string;
  }
) {
  try {
    const session = await getAuthenticatedSession();
    if (
      !session ||
      !data.privateKey ||
      !data.publicKey
    ) {
      return {
        errors: { message: "Unable to store user keys." },
        success: { message: null },
        data: null
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, oAuthSignup: true }
    });
    if (!user || user.oAuthSignup) {
      return {
        errors: { message: "Unable to store user keys." },
        success: { message: null },
        data: null
      };
    }

    const updatedUser = await prisma.user.update({
      where: { id: session.userId },
      data: {
        publicKey: JSON.stringify(data.publicKey),
        privateKey: data.privateKey
      },
      select: { publicKey: true }
    });

    return {
      errors: { message: null },
      success: { message: "User keys stored successfully." },
      data: { publicKey: updatedUser.publicKey }
    };
  } catch {
    console.error("Manual user key storage failed.");
    return {
      errors: { message: "Unable to store user keys." },
      success: { message: null },
      data: null
    };
  }
}

// --- SEND OTP ---
export async function sendOtp(_prevState: unknown) {
  void _prevState;

  try {
    const session = await getAuthenticatedSession();
    if (!session) {
      return {
        errors: { message: "Authentication is required." },
        success: { message: null }
      };
    }

    const otpSendDecision = consumeLayeredLimit(
      session.userId,
      RATE_LIMITS.otpSendCooldown,
      RATE_LIMITS.otpSendWindow,
    );
    if (!otpSendDecision.allowed) {
      return {
        errors: { message: RATE_LIMIT_MESSAGE },
        success: { message: null }
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, email: true, username: true }
    });

    if (!user?.email || !user.username) {
      return {
        errors: { message: 'Missing user information for OTP.' },
        success: { message: null }
      };
    }

    await prisma.otp.deleteMany({ where: { userId: user.id } });

    const otp = generateOtp(); // Assuming this generates a string OTP
    const hashedOtp = await bcrypt.hash(otp, 10);

    await prisma.otp.create({
      data: {
        userId: user.id,
        hashedOtp,
        expiresAt: new Date(Date.now() + 1000 * 60 * 5) // OTP valid for 5 minutes
      }
    });

    await sendEmail({ emailType: "OTP", to: user.email, username: user.username, otp });

    return {
      errors: {
        message: null
      },
      success: {
        message: `We have sent an OTP to ${user.email}. Please check your inbox (and spam folder).`
      }
    };
  } catch (error) {
    console.error('Error sending OTP:', error);
    return {
      errors: {
        message: 'Error sending OTP.'
      },
      success: {
        message: null
      }
    };
  }
}

// --- VERIFY OTP ---
export async function verifyOtp(_prevState: unknown, data: { otp: string }) {
  try {
    const session = await getAuthenticatedSession();
    if (!session) {
      return {
        errors: { message: "Authentication is required." },
        success: { message: null }
      };
    }

    const { otp } = data;

    if (!otp) {
      return {
        errors: { message: 'OTP is required.' },
        success: { message: null }
      };
    }

    if (!consumeServerActionRateLimit(RATE_LIMITS.otpVerify, session.userId).allowed) {
      return {
        errors: { message: RATE_LIMIT_MESSAGE },
        success: { message: null }
      };
    }

    const otpExists = await prisma.otp.findFirst({
      where: { userId: session.userId }
    });

    if (!otpExists) {
      return {
        errors: {
          message: 'OTP does not exist or has already been used.'
        },
        success: {
          message: null
        }
      };
    }

    if (otpExists.expiresAt! < new Date()) { // Use non-null assertion if you're certain it's always there
      await prisma.otp.delete({ where: { id: otpExists.id } }); // Clean up expired OTP
      return {
        errors: {
          message: 'OTP has expired. Please request a new one.'
        },
        success: {
          message: null
        }
      };
    }

    if (!(await bcrypt.compare(otp, otpExists.hashedOtp))) {
      return {
        errors: {
          message: 'Invalid OTP. Please try again.'
        },
        success: {
          message: null
        }
      };
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: session.userId },
        data: { emailVerified: true },
      }),
      prisma.otp.delete({ where: { id: otpExists.id } })
    ]);
    resetServerActionRateLimit(RATE_LIMITS.otpVerify, session.userId);

    return {
      errors: {
        message: null
      },
      success: {
        message: 'Email verified successfully 🎉'
      },
    };
  } catch (error) {
    console.error('Error verifying OTP:', error);
    return {
      errors: {
        message: 'Error verifying OTP.'
      },
      success: {
        message: null
      }
    };
  }
}

// --- GET AUTH TOKEN (for client-side access) ---
export async function getAuthToken() {
  const session = await getAuthenticatedSession();
  return session?.token ?? null;
}
// Note: This function is for server-side use only. Ensure you handle the token securely.
