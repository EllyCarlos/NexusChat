"use server";

import { DEFAULT_AVATAR } from "@/constants";
import { sendEmail } from "@/lib/server/email/SendEmail";
import { generateOtp } from "@/lib/server/helpers";
import { prisma } from "@/lib/server/prisma";
import { FetchUserInfoResponse } from "@/lib/server/services/userService";
import { createSession, decrypt, deleteSession, encrypt, SessionPayload } from "@/lib/server/session"; // Make sure SessionPayload is exported from session.ts
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import jwt from 'jsonwebtoken'; // Keep this for verifyOAuthToken

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
export async function sendPrivateKeyRecoveryEmail(prevState: any, user: Pick<FetchUserInfoResponse, "id" | "email" | "username">) {
  try {
    const { email, id, username } = user;

    if (!email || !id || !username) {
      return {
        errors: { message: "User information is incomplete." },
        success: { message: null }
      };
    }

    // Use a short-lived token for email verification, not session token
    // This token is for the URL, and its expiry should be managed carefully.
    const privateKeyRecoveryToken = await encrypt({
      userId: id,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60) // Token valid for 1 hour for URL
    });

    // Hash the token to store in the database for comparison
    const privateKeyRecoveryHashedToken = await bcrypt.hash(privateKeyRecoveryToken, 10);

    // Clear any old tokens for this user before creating a new one
    await prisma.privateKeyRecoveryToken.deleteMany({
      where: { userId: id }
    });

    // Store the hashed token with a longer expiry, as this is the actual DB record expiry
    await prisma.privateKeyRecoveryToken.create({
      data: {
        userId: id,
        hashedToken: privateKeyRecoveryHashedToken,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) // Database record valid for 7 days
      }
    });

    const privateKeyRecoveryUrl = `${process.env.NEXT_PUBLIC_CLIENT_URL}/auth/private-key-recovery-token-verification?token=${privateKeyRecoveryToken}`;

    await sendEmail({ emailType: "privateKeyRecovery", to: email, username, verificationUrl: privateKeyRecoveryUrl });

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
export async function verifyPrivateKeyRecoveryToken(prevState: any, data: { recoveryToken: string, userId: string }) {
  try {
    if (!data.recoveryToken || !data.userId) {
      return {
        errors: { message: 'Invalid request: Token or User ID missing.' },
        data: null
      };
    }

    // 1. Get the stored hashed token from the database
    const recoveryTokenExists = await prisma.privateKeyRecoveryToken.findFirst({
      where: { userId: data.userId }
    });

    if (!recoveryTokenExists) {
      console.warn(`No recovery token found for userId: ${data.userId}`);
      return {
        errors: {
          message: 'Verification link is invalid or already used.'
        },
        data: null
      };
    }

    // 2. Check if the stored token has expired
    if (recoveryTokenExists.expiresAt < new Date()) {
      // Clean up expired token
      await prisma.privateKeyRecoveryToken.delete({ where: { id: recoveryTokenExists.id } });
      console.warn(`Recovery token expired for userId: ${data.userId}`);
      return {
        errors: {
          message: 'Verification link has expired. Please request a new one.'
        },
        data: null
      };
    }

    // 3. Compare the provided token with the hashed token in the database
    if (!(await bcrypt.compare(data.recoveryToken, recoveryTokenExists.hashedToken))) {
      console.warn(`Mismatched recovery token hash for userId: ${data.userId}`);
      return {
        errors: {
          message: 'Verification link is invalid. Please ensure the full link is used.'
        },
        data: null
      };
    }

    // 4. Decrypt the provided token to check its payload (jose)
    const decodedPayload = await decrypt(data.recoveryToken);

    if (!decodedPayload || decodedPayload.userId !== data.userId || new Date(decodedPayload.expiresAt) < new Date()) {
      console.warn(`Decrypted payload mismatch or expired. Provided userId: ${data.userId}, Decoded userId: ${decodedPayload?.userId}, Expired: ${new Date(decodedPayload?.expiresAt || 0) < new Date()}`);
      return {
        errors: {
          message: 'Verification link is invalid or expired. Please request a new one.'
        },
        data: null
      };
    }

    // 5. Fetch the user and their private key data
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { id: true, privateKey: true, oAuthSignup: true, googleId: true }
    });

    if (!user) {
      console.warn(`User not found during private key recovery verification for userId: ${data.userId}`);
      return {
        errors: {
          message: 'User not found. Verification link is not valid.'
        },
        data: null
      };
    }

    // Create a new session for the user upon successful token verification
    // This authenticates the user for subsequent actions on the recovery page
    await createSession(user.id);

    // Prepare payload based on signup type
    const payload: { privateKey?: string; combinedSecret?: string } = {};

    if (user.privateKey) {
      payload.privateKey = user.privateKey;
    } else {
      console.warn(`User ${user.id} has no privateKey. This should not happen for a recovery flow for non-OAuth users.`);
      // If a user has no private key, what are they recovering? This might indicate an issue.
      // Consider throwing an error or returning a specific message.
      return {
        errors: {
          message: 'No private key found for this user account.'
        },
        data: null
      };
    }


    // If user signed up with OAuth, their key is encrypted with a derived secret
    if (user.oAuthSignup && user.googleId && process.env.PRIVATE_KEY_RECOVERY_SECRET) {
      payload.combinedSecret = user.googleId + process.env.PRIVATE_KEY_RECOVERY_SECRET;
    } else if (user.oAuthSignup && (!user.googleId || !process.env.PRIVATE_KEY_RECOVERY_SECRET)) {
        console.error("OAuth user missing googleId or PRIVATE_KEY_RECOVERY_SECRET");
        return {
            errors: {
                message: "OAuth user configuration error for private key recovery."
            },
            data: null
        };
    }

    // Delete the database token record after successful use to prevent replay attacks
    await prisma.privateKeyRecoveryToken.delete({ where: { id: recoveryTokenExists.id } });
    console.log(`Successfully verified recovery token and deleted record for userId: ${data.userId}`);

    return {
      errors: {
        message: null
      },
      data: payload
    };

  } catch (error) {
    console.error('Error verifying private key recovery token:', error);
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
export async function verifyPassword(prevState: any, data: { userId: string, password: string }) {
  try {
    const { password, userId } = data;

    if (!userId || !password) {
      return {
        errors: { message: "User ID and password are required." },
        success: { message: null }
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

    // If password is correct, generate and send a private key recovery email
    // This is essentially triggering the same flow as `sendPrivateKeyRecoveryEmail`
    const privateKeyRecoveryToken = await encrypt({
      userId,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60) // Token valid for 1 hour for URL
    });
    const privateKeyRecoveryHashedToken = await bcrypt.hash(privateKeyRecoveryToken, 10);

    await prisma.privateKeyRecoveryToken.deleteMany({
      where: { userId }
    });
    await prisma.privateKeyRecoveryToken.create({
      data: {
        userId,
        hashedToken: privateKeyRecoveryHashedToken,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) // Database record valid for 7 days
      }
    });

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

    const resetPasswordToken = await encrypt({
      userId: user.id,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60) // Token valid for 1 hour for URL
    });

    const hashedResetToken = await bcrypt.hash(resetPasswordToken, 10);

    await prisma.resetPasswordToken.deleteMany({
      where: { userId: user.id }
    });

    await prisma.resetPasswordToken.create({
      data: {
        userId: user.id,
        hashedToken: hashedResetToken,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24) // Database record valid for 24 hours
      }
    });

    const resetUrl = `${process.env.NEXT_PUBLIC_CLIENT_URL}/auth/reset-password?token=${resetPasswordToken}`;

    await sendEmail({
      emailType: "resetPassword",
      to: user.email,
      username: user.username,
      verificationUrl: resetUrl
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function verifyOAuthToken(prevState: any, token: string) {
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

    const decoded = jwt.verify(token, process.env.JWT_SECRET) as any;

    console.log('🔍 Decoded token structure:', {
      keys: Object.keys(decoded),
      userId: decoded.userId,
      isNewUser: decoded.isNewUser,
      type: decoded.type
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
        googleId: true, // Select googleId if used for combinedSecret
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

    // Create session
    await createSession(user.id);

    const responseData: any = {
      user,
      sessionToken: token // Consider if you truly need to send back the original token
    };

    // If it's a new OAuth user, generate combinedSecret for initial key encryption
    if (decoded.isNewUser && user.oAuthSignup && user.googleId && process.env.PRIVATE_KEY_RECOVERY_SECRET) {
      // The combinedSecret should be derived in a way that's reproducible by the client
      // for decrypting the private key if stored with this secret.
      // Make sure this matches how you derive it in `verifyPrivateKeyRecoveryToken`
      responseData.combinedSecret = user.googleId + process.env.PRIVATE_KEY_RECOVERY_SECRET;
      console.log('🆕 New OAuth user - added combinedSecret for initial key generation/encryption');
    }

    console.log('✅ OAuth verification successful for user:', user.id);
    return {
      errors: {
        message: null
      },
      data: responseData
    };

  } catch (error) {
    console.error('🚨 OAuth token verification error:', error);

    if (error instanceof Error) {
      if (error.name === 'JsonWebTokenError') {
        console.error('JWT Error details:', error.message);
        return {
          errors: {
            message: "Invalid token format."
          },
          data: null
        };
      }
      if (error.name === 'TokenExpiredError') {
        console.error('Token expired');
        return {
          errors: {
            message: "Token has expired. Please try logging in again."
          },
          data: null
        };
      }
    }

    console.error('Unexpected error during OAuth token verification:', error);
    return {
      errors: {
        message: "Token verification failed. Please try again."
      },
      data: null
    };
  }
}

// --- RESET PASSWORD ---
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function resetPassword(prevState: any, data: { token: string, newPassword: string }) {
  try {
    const { newPassword, token } = data;

    if (!newPassword || !token) {
      return {
        errors: { message: 'New password and token are required.' },
        success: { message: null }
      };
    }

    // Decrypt the token to get the userId and check its internal expiry
    const decodedPayload = await decrypt(token);

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

// --- STORE USER KEYS IN DATABASE ---
export async function storeUserKeysInDatabase(prevState: any, data: { publicKey: JsonWebKey, privateKey: string, loggedInUserId: string }) {
  try {
    console.log('Action `storeUserKeysInDatabase` called.');
    const { privateKey, publicKey, loggedInUserId } = data;

    if (!privateKey || !publicKey || !loggedInUserId) {
      return {
        errors: { message: 'Missing key data or user ID.' },
        success: { message: null }
      };
    }

    const user = await prisma.user.findUnique({ where: { id: loggedInUserId } });
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

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { publicKey: JSON.stringify(publicKey), privateKey },
      select: { publicKey: true } // Only select what's needed for the response
    });

    return {
      errors: {
        message: null
      },
      success: {
        message: 'User keys stored in database successfully.'
      },
      data: {
        publicKey: updatedUser.publicKey
      }
    };

  } catch (error) {
    console.error('Error storing user keys in database:', error);
    return {
      errors: {
        message: 'Error storing user keys in database.'
      },
      success: {
        message: null
      }
    };
  }
}

// --- SEND OTP ---
export async function sendOtp(prevState: any, data: { loggedInUserId: string, email: string, username: string }) {
  try {
    const { loggedInUserId, email, username } = data;

    if (!loggedInUserId || !email || !username) {
      return {
        errors: { message: 'Missing user information for OTP.' },
        success: { message: null }
      };
    }

    await prisma.otp.deleteMany({ where: { userId: loggedInUserId } });

    const otp = generateOtp(); // Assuming this generates a string OTP
    const hashedOtp = await bcrypt.hash(otp, 10);

    await prisma.otp.create({
      data: {
        userId: loggedInUserId,
        hashedOtp,
        expiresAt: new Date(Date.now() + 1000 * 60 * 5) // OTP valid for 5 minutes
      }
    });

    await sendEmail({ emailType: "OTP", to: email, username, otp: otp });

    return {
      errors: {
        message: null
      },
      success: {
        message: `We have sent an OTP to ${email}. Please check your inbox (and spam folder).`
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
export async function verifyOtp(prevState: any, data: { otp: string, loggedInUserId: string }) {
  try {
    const { otp, loggedInUserId } = data;

    if (!otp || !loggedInUserId) {
      return {
        errors: { message: 'OTP and user ID are required.' },
        success: { message: null }
      };
    }

    const otpExists = await prisma.otp.findFirst({
      where: { userId: loggedInUserId }
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

    // Update user's emailVerified status
    await prisma.user.update({
      where: { id: loggedInUserId },
      data: { emailVerified: true },
    });

    // Delete the used OTP record
    await prisma.otp.delete({ where: { id: otpExists.id } });

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
  // Make sure this aligns with the cookie name set in session.ts (e.g., "session")
  const token = (await cookies()).get("session")?.value;
  return token || null;
}
// Note: This function is for server-side use only. Ensure you handle the token securely.