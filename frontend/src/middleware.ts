import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { FetchUserInfoResponse } from "./lib/server/services/userService";
import { decrypt, SessionPayload } from "./lib/server/session";

const publicRoutes = [
  "/auth/login",
  "/auth/signup",
  "/auth/forgot-password",
  "/auth/reset-password",
];
const protectedRoutes = [
  "/",
  "/auth/verification",
];

// Exclude Next.js static files and internal paths
const ignoredPaths = ["/_next", "/favicon.ico", "/api"];

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Ignore Next.js assets & API routes
  if (ignoredPaths.some(ignoredPath => path.startsWith(ignoredPath))) {
    return NextResponse.next();
  }

  const isProtectedRoute = protectedRoutes.includes(path);
  const isPublicRoute = publicRoutes.includes(path);

  const token = req.cookies.get("token")?.value;

  // Decrypt session from token
  const session = token ? (await decrypt(token) as SessionPayload) : null;
  
  // If session is invalid, redirect for protected routes
  if (!session?.userId && isProtectedRoute) {
    const redirectResponse =  NextResponse.redirect(new URL("/auth/login", req.url));
    redirectResponse.cookies.set("token","", {expires: new Date(0), path: "/"});
    return redirectResponse;
  }
  // Redirect logged-in users away from public routes
  if (session?.userId && isPublicRoute) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }
  
  let userInfo: FetchUserInfoResponse | null = null;

  // Only fetch user info if necessary
  if (isProtectedRoute && session?.userId) {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/auth/user`, {
        headers: { "Cookie": `token=${token}` },
      });
      if (res.ok) {
        userInfo = await res.json() as FetchUserInfoResponse;
      }
      else {
        const redirectResponse =  NextResponse.redirect(new URL("/auth/login", req.url))
        redirectResponse.cookies.set("token","", {expires: new Date(0), path: "/"});
        return redirectResponse;
      }
    } catch (error) {
      console.error("Error fetching user info in middleware:", error);
      return NextResponse.redirect(new URL("/auth/login", req.url)).cookies.set("token","", {expires: new Date(0), path: "/"});
    }
  }

  // Redirect unverified users to verification page (unless already there)
  if (userInfo && !userInfo.emailVerified) {

    let response = null;

    if(path !== "/auth/verification") response = NextResponse.redirect(new URL("/auth/verification", req.url));
    else response = NextResponse.next();

    response.cookies.set("tempUserInfo", JSON.stringify(userInfo), {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
    return response
  }

  if (session?.userId) {
    const response = NextResponse.next();
    response.cookies.set("loggedInUserId", session.userId, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  }

  return NextResponse.next();

}
