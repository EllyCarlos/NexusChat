import 'server-only'; // Ensures this module only runs on the server
import { SignJWT, jwtVerify } from "jose"; // Using jose for JWT operations
import { cookies } from "next/headers"; // Next.js utility for accessing cookies

export type SessionPayload = {
  userId: string;
  expiresAt: Date; // This will be the expiration date of the session
};

const getEncodedJwtSecret = () => {
  const secretKey = process.env.JWT_SECRET;
  if (!secretKey) {
    throw new Error("JWT_SECRET environment variable is not defined! Please set it securely.");
  }
  return new TextEncoder().encode(secretKey);
};

/**
 * Creates a new user session and sets it as an HTTP-only cookie.
 * @param userId The ID of the user to create a session for.
 */
export async function createSession(userId: string) {
  // Calculate expiry for the JWT payload and the cookie
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

  // Encrypt the session payload into a JWT
  const sessionToken = await encrypt({ userId, expiresAt });
  const cookieStore = await cookies();

  // Set the non-authentication cookie first so the session cookie is the final operation.
  cookieStore.set("loggedInUserId", userId, {
    expires: expiresAt,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none',
    path: '/',
  });

  cookieStore.set("session", sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    sameSite: 'none',
    path: '/',
  });
}

/**
 * Deletes the user session cookies.
 */
export async function deleteSession() {
  (await cookies()).delete("session"); // Delete the main session cookie
  (await cookies()).delete("loggedInUserId"); // Delete the client-side user ID cookie
}

/**
 * Encrypts a session payload into a JSON Web Token (JWT).
 * @param payload The session data to encrypt.
 * @returns The signed JWT string.
 */
export async function encrypt(payload: SessionPayload): Promise<string> {
  const expiresAt = new Date(payload.expiresAt);

  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error("Token expiry is invalid.");
  }

  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" }) // Algorithm used for signing
    .setIssuedAt() // Set the issuance time
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(getEncodedJwtSecret()); // Sign the JWT with the secret key
}

/**
 * Decrypts a JWT session token and returns its payload.
 * @param session The JWT string to decrypt.
 * @returns The decrypted session payload or a default/error payload if verification fails.
 */
export async function decrypt(session: string | undefined = ""): Promise<SessionPayload> {
  if (!session) {
    // If no session token is provided, return an invalid/expired payload
    return { userId: "", expiresAt: new Date(0) };
  }
  const encodedKey = getEncodedJwtSecret();
  try {
    const { payload } = await jwtVerify(session, encodedKey, {
      algorithms: ["HS256"], // Specify expected algorithms
    });
    // Ensure payload matches SessionPayload structure (type assertion)
    return payload as SessionPayload;
  } catch (error) {
    console.error("Failed to verify session during decryption:", error);
    // Return a payload that indicates an invalid/expired session
    // This allows calling code to check `expiresAt` or `userId` to determine validity
    return { userId: "", expiresAt: new Date(0) }; // Return an expired date for invalid sessions
  }
}

/**
 * Verifies a session token and returns the userId if valid and not expired.
 * This is a new utility function specifically for API routes or server components
 * that need to check authentication.
 * @param sessionToken The session token string from cookies.
 * @returns The userId if the session is valid, otherwise null.
 */
export async function verifySession(sessionToken: string | undefined): Promise<string | null> {
  if (!sessionToken) {
    return null;
  }
  getEncodedJwtSecret();
  try {
    const payload = await decrypt(sessionToken);
    // Check if the session is still valid based on its expiry date
    if (payload.expiresAt && new Date(payload.expiresAt) > new Date()) {
      return payload.userId;
    }
    console.warn("Session expired or invalid expiry date in payload.");
    return null;
  } catch (error) {
    console.error("Error verifying session:", error);
    return null;
  }
}
