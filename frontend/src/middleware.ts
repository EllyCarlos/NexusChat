import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { FetchUserInfoResponse } from "./lib/server/services/userService";
import { decrypt, SessionPayload } from "./lib/server/session";

const publicRoutes = new Set([
  "/auth/login",
  "/auth/signup",
  "/auth/forgot-password",
  "/auth/reset-password",
]);

const protectedRoutes = new Set([
  "/",
  "/auth/verification",
]);

// Exclude Next.js static files and internal paths
const ignoredPaths = ["/_next", "/favicon.ico", "/api", "/_vercel"];

// Helper function to clear authentication and redirect
function clearAuthAndRedirect(req: NextRequest, redirectPath: string = "/auth/login") {
  const redirectResponse = NextResponse.redirect(new URL(redirectPath, req.url));
  redirectResponse.cookies.set("token", "", { 
    expires: new Date(0), 
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production"
  });
  redirectResponse.cookies.set("loggedInUserId", "", { 
    expires: new Date(0), 
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production"
  });
  return redirectResponse;
}

// Helper function to set secure cookie
function setSecureCookie(response: NextResponse, name: string, value: string, options: any = {}) {
  response.cookies.set(name, value, {
    httpOnly: true,
    sameSite: "none",
    path: "/",
    secure: process.env.NODE_ENV === "production",
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
  const token = req.cookies.get("token")?.value;

  // Early return for non-route-specific paths
  if (!isProtectedRoute && !isPublicRoute) {
    return NextResponse.next();
  }

  let session: SessionPayload | null = null;
  
  // Decrypt session from token
  if (token) {
    try {
      session = await decrypt(token) as SessionPayload;
    } catch (error) {
      console.error("Error decrypting session:", error);
      // Invalid token, clear it
      if (isProtectedRoute) {
        return clearAuthAndRedirect(req);
      }
    }
  }
 
  // Handle protected routes without valid session
  if (!session?.userId && isProtectedRoute) {
    return clearAuthAndRedirect(req);
  }
  
  // Redirect logged-in users away from public routes
  if (session?.userId && isPublicRoute) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  // Skip user info fetch if not needed
  if (!isProtectedRoute || !session?.userId) {
    return NextResponse.next();
  }

  let userInfo: FetchUserInfoResponse | null = null;

  // Fetch user info for protected routes
  try {
    // Skip API calls during build time
    if (process.env.NODE_ENV === "production" && !process.env.VERCEL_URL && !req.nextUrl.host.includes("vercel.app")) {
      return NextResponse.next();
    }

    const baseUrl = process.env.NEXT_PUBLIC_API_URL || 
                   `${req.nextUrl.protocol}//${req.nextUrl.host}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const res = await fetch(`${baseUrl}/api/v1/auth/user`, {
      headers: {
        // Changed from "Cookie" to "Authorization" with "Bearer" prefix
        "Authorization": `Bearer ${token}`, 
        "User-Agent": req.headers.get("user-agent") || "",
        "Accept": "application/json",
      },
      signal: controller.signal,
      cache: 'no-store', // Prevent caching sensitive user data
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return clearAuthAndRedirect(req);
      }
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    userInfo = await res.json() as FetchUserInfoResponse;
    
  } catch (error) {
    console.error("Error fetching user info in middleware:", error);
    
    // More specific error handling
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        console.warn("User info fetch timed out");
      } else if (error.message.includes('ECONNREFUSED')) {
        console.warn("API server not available during build/dev");
        return NextResponse.next();
      }
    }
    
    // During build or when API is unavailable, allow through
    if (process.env.NODE_ENV !== "production" || process.env.VERCEL_ENV === "preview") {
      return NextResponse.next();
    }
    
    return clearAuthAndRedirect(req);
  }

  // Handle email verification
  if (userInfo && !userInfo.emailVerified) {
    const response = path !== "/auth/verification" 
      ? NextResponse.redirect(new URL("/auth/verification", req.url))
      : NextResponse.next();
   
    setSecureCookie(response, "tempUserInfo", JSON.stringify(userInfo), {
      maxAge: 60 * 60 // 1 hour expiry for temp user info
    });
    
    return response;
  }

  // Set logged-in user ID for verified users
  if (session?.userId && userInfo?.emailVerified) {
    const response = NextResponse.next();
    setSecureCookie(response, "loggedInUserId", session.userId);
    return response;
  }

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
     * - public folder
     */
     "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)",
  ],
};