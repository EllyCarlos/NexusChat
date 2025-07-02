import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { decrypt, SessionPayload } from "./lib/server/session"; // Ensure correct path
import { FetchUserInfoResponse } from "./lib/server/services/userService"; // Ensure correct path

// Define public routes (accessible without login)
const publicRoutes = new Set([
  "/auth/login",
  "/auth/signup",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/private-key-recovery-token-verification", // This page needs to be public
]);

// Define routes that require authentication
const protectedRoutes = new Set([
  "/", // Home/Chat page
  "/auth/verification", // Email verification page
  // Add any other routes that require authentication here
]);

// Exclude Next.js static files and internal paths from middleware processing
const ignoredPaths = ["/_next", "/favicon.ico", "/api", "/_vercel", "/public"]; // Added /public

// Helper function to clear authentication cookies and redirect
function clearAuthAndRedirect(req: NextRequest, redirectPath: string = "/auth/login") {
  const redirectResponse = NextResponse.redirect(new URL(redirectPath, req.url));
  // Clear the main session cookie
  redirectResponse.cookies.set("session", "", {
    expires: new Date(0),
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // Match sameSite from session.ts
    partitioned: true // Match partitioned from session.ts
  });
  // Clear the client-side loggedInUserId cookie (if you're still using it directly)
  redirectResponse.cookies.set("loggedInUserId", "", {
    expires: new Date(0),
    path: "/",
    // Note: loggedInUserId is typically not httpOnly, but if it was, keep it consistent
    // httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // Match sameSite from session.ts
    partitioned: true // Match partitioned from session.ts
  });
  return redirectResponse;
}

// Helper function to set secure cookie (ensure consistency with session.ts)
function setSecureCookie(response: NextResponse, name: string, value: string, options: any = {}) {
  response.cookies.set(name, value, {
    httpOnly: true, // Keep httpOnly for session tokens
    sameSite: "lax", // Consistent with session.ts
    path: "/",
    secure: process.env.NODE_ENV === "production",
    partitioned: true, // Consistent with session.ts
    ...options
  });
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Ignore Next.js assets, API routes, and build-time paths
  if (ignoredPaths.some(ignoredPath => path.startsWith(ignoredPath))) {
    return NextResponse.next();
  }

  const isProtectedRoute = protectedRoutes.has(path);
  const isPublicRoute = publicRoutes.has(path);

  // IMPORTANT: Get the correct session cookie name
  const sessionToken = req.cookies.get("session")?.value; // <--- Changed from "token" to "session"

  // If the path is neither protected nor public, allow it through (e.g., static assets not covered by ignoredPaths)
  if (!isProtectedRoute && !isPublicRoute) {
    return NextResponse.next();
  }

  let session: SessionPayload | null = null;

  // Decrypt session from token
  if (sessionToken) { // Use sessionToken variable
    try {
      session = await decrypt(sessionToken) as SessionPayload;
      // Also check if the session payload itself is expired based on its internal expiry
      if (session && new Date(session.expiresAt) <= new Date()) {
        console.warn("Middleware: Session token expired based on payload expiry.");
        session = null; // Mark as expired
      }
    } catch (error) {
      console.error("Middleware: Error decrypting session token:", error);
      session = null; // Mark as invalid
    }
  }

  // Handle protected routes without a valid session
  if (!session?.userId && isProtectedRoute) {
    console.log(`Middleware: Redirecting unauthenticated user from protected route: ${path}`);
    return clearAuthAndRedirect(req);
  }

  // Redirect logged-in users away from public routes (unless it's the recovery page)
  // Allow access to recovery page even if logged in, as it's a specific flow
  if (session?.userId && isPublicRoute && path !== "/auth/private-key-recovery-token-verification") {
    console.log(`Middleware: Redirecting authenticated user from public route: ${path} to /`);
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  // If not a protected route or no session, allow it (e.g., public routes with no session, or non-auth routes)
  if (!isProtectedRoute || !session?.userId) {
    return NextResponse.next();
  }

  // --- At this point, we are on a PROTECTED ROUTE and have a VALID SESSION. ---
  // Now, fetch user info to get additional details like emailVerified and needsKeyRecovery.
  let userInfo: FetchUserInfoResponse | null = null;

  try {
    // Skip API calls during build time (important for Vercel builds)
    if (process.env.NEXT_PUBLIC_API_URL === undefined && process.env.NODE_ENV === "production") {
      console.warn("Middleware: NEXT_PUBLIC_API_URL is not defined in production. Skipping user info fetch.");
      return NextResponse.next(); // Allow through if API URL is not configured
    }
    
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || `${req.nextUrl.protocol}//${req.nextUrl.host}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5-second timeout

    const res = await fetch(`${baseUrl}/api/v1/auth/user`, {
      headers: {
        // Use the session token in the Authorization header for backend API
        "Authorization": `Bearer ${sessionToken}`,
        "User-Agent": req.headers.get("user-agent") || "",
        "Accept": "application/json",
      },
      signal: controller.signal,
      cache: 'no-store', // Prevent caching sensitive user data
    });

    clearTimeout(timeoutId); // Clear timeout if fetch completes in time

    if (!res.ok) {
      console.error(`Middleware: Failed to fetch user info. Status: ${res.status}, Message: ${res.statusText}`);
      if (res.status === 401 || res.status === 403) {
        // If API returns unauthorized, clear session and redirect
        return clearAuthAndRedirect(req);
      }
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    userInfo = await res.json() as FetchUserInfoResponse;

  } catch (error) {
    console.error("Middleware: Error fetching user info:", error);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        console.warn("Middleware: User info fetch timed out.");
      } else if (error.message.includes('ECONNREFUSED')) {
        console.warn("Middleware: API server not available (ECONNREFUSED). This might happen during local dev or specific build environments.");
        // During build or when API is unavailable, allow through.
        // This is crucial for local development where the API might not be running yet.
        return NextResponse.next();
      }
    }

    // For any other critical error during user info fetch, clear auth and redirect
    return clearAuthAndRedirect(req);
  }

  // --- Handle email verification ---
  if (userInfo && !userInfo.emailVerified) {
    // If user is not verified and not already on the verification page, redirect them
    const response = path !== "/auth/verification"
      ? NextResponse.redirect(new URL("/auth/verification", req.url))
      : NextResponse.next(); // Already on verification page, allow through

    // Set tempUserInfo cookie for the verification page to use
    setSecureCookie(response, "tempUserInfo", JSON.stringify(userInfo), {
      maxAge: 60 * 60 // 1 hour expiry for temp user info
    });

    return response;
  }

  // --- Handle Private Key Recovery (NEW LOGIC) ---
  // If user needs key recovery AND is not on the recovery verification page, redirect them
  if (userInfo && userInfo.needsKeyRecovery && path !== "/auth/private-key-recovery-token-verification") {
    console.log(`Middleware: User ${userInfo.id} needs key recovery. Redirecting to recovery page.`);
    // Redirect to the private key recovery page
    return NextResponse.redirect(new URL("/auth/private-key-recovery-token-verification", req.url));
  }

  // Set logged-in user ID for client-side use (if still needed, though Redux is preferred)
  // This cookie is less critical if Redux is the source of truth for loggedInUser.
  if (session?.userId) { // Removed userInfo?.emailVerified as a condition here, as it's handled above
    const response = NextResponse.next();
    // Changed cookie name from "loggedInUserId" to "sessionUserId" or similar if you want to avoid confusion
    // with the backend's "loggedInUserId" or if it's purely client-side convenience.
    // For now, keeping "loggedInUserId" but be mindful of its source.
    setSecureCookie(response, "loggedInUserId", session.userId, { httpOnly: false }); // httpOnly: false for client-side access
    return response;
  }

  // If all checks pass, proceed to the requested page
  return NextResponse.next();
}

// Configure which paths this middleware should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder (if you have one and want to exclude it, or use a more specific regex)
     * - any file with a dot (e.g., .png, .jpg, .css, .js)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)",
  ],
};
// This matcher will apply the middleware to all paths except those explicitly excluded.
// Adjust the matcher as needed based on your application's structure and requirements.