import 'server-only';
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import "server-only";

export type SessionPayload = {
  userId: string;
  expiresAt: Date;
};

// --- FIX: Use JWT_SECRET consistently across frontend and backend ---
const secretKey = process.env.JWT_SECRET; // Changed from SESSION_SECRET
if (!secretKey) {
  // This check is important for build/runtime errors if the env var isn't set
  throw new Error("JWT_SECRET environment variable is not defined!");
}
const encodedKey = new TextEncoder().encode(secretKey);

export async function createSession(userId: string) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  const session = await encrypt({ userId, expiresAt });

  // Set the token as an HTTP-only, secure cookie
  (await cookies()).set("token", session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // Use secure: true in production
    expires: expiresAt,
    // Consider adding `sameSite: 'lax'` or 'strict' for security:
    sameSite: 'lax',
    // If frontend and backend are on different subdomains of the same root domain,
    // you might need to set a common `domain`:
    // domain: '.yourdomain.com', // Uncomment and replace if applicable
  });
}

export async function deleteSession() {
  (await cookies()).delete("token").delete("loggedInUserId");
}

export async function encrypt(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d") // Match cookie expiry
    .sign(encodedKey);
}

export async function decrypt(session: string | undefined = "") {
  try {
    const { payload } = await jwtVerify(session, encodedKey, {
      algorithms: ["HS256"],
    });
    return payload;
  } catch (error) {
    console.error("Failed to verify session during decryption:", error); // Use console.error for errors
    return {
      userId: "", // Return default or throw error for clearer handling upstream
      expiresAt: new Date(0), // Return an expired date for invalid sessions
    } as SessionPayload; // Explicitly cast to SessionPayload
  }
}
