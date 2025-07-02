import 'server-only'; // Ensures this module only runs on the server
import { SignJWT, jwtVerify } from "jose"; // Using jose for JWT operations
import { cookies } from "next/headers"; // Next.js utility for accessing cookies

export type SessionPayload = {
  userId: string;
  expiresAt: Date; // This will be the expiration date of the session
};

// --- IMPORTANT: Ensure JWT_SECRET is consistently set in your environment variables ---
const secretKey = process.env.JWT_SECRET;
if (!secretKey) {
  // Throw an error if the secret is not defined. This is a critical configuration.
  throw new Error("JWT_SECRET environment variable is not defined! Please set it securely.");
}
const encodedKey = new TextEncoder().encode(secretKey); // Encode the secret key for jose

/**
 * Creates a new user session and sets it as an HTTP-only cookie.
 * @param userId The ID of the user to create a session for.
 */
export async function createSession(userId: string) {
  // Calculate expiry for the JWT payload and the cookie
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

  // Encrypt the session payload into a JWT
  const sessionToken = await encrypt({ userId, expiresAt });

  // Set the JWT as an HTTP-only, secure cookie
  (await cookies()).set("session", sessionToken, { // Set the cookie name
    httpOnly: true, // Prevents client-side JavaScript from accessing the cookie
    secure: process.env.NODE_ENV === 'production', // Only send cookie over HTTPS in production
    expires: expiresAt, // Set the cookie's expiration date
    sameSite: 'lax', // Protects against CSRF attacks (consider 'strict' for higher security)
    path: '/', // The cookie is accessible from all paths
    // domain: '.yourdomain.com', // Uncomment and replace if your frontend and backend are on different subdomains of the same root domain
  });

  // You might also want to set a simple loggedInUserId cookie (not httpOnly) for client-side use if needed
  (await cookies()).set("loggedInUserId", userId, {
    expires: expiresAt,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
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
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" }) // Algorithm used for signing
    .setIssuedAt() // Set the issuance time
    .setExpirationTime("30d") // Set JWT expiration time (matches cookie expiry)
    .sign(encodedKey); // Sign the JWT with the secret key
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