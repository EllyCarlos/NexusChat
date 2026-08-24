import { getRedirectUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { config, proxy } from "../src/proxy";
import {
  signPasswordResetToken,
  signSessionToken,
} from "../src/lib/server/session";

const ORIGIN = "https://nexuschat.test";
const API_ORIGIN = "https://api.nexuschat.test";
const JWT_SECRET = "proxy-auth-routing-test-secret";
const USER_ID = "proxy-user";

const originalEnvironment = {
  jwtSecret: process.env.JWT_SECRET,
  nodeEnv: process.env.NODE_ENV,
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
};

const restoreEnvironmentVariable = (name: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
};

const futureExpiry = () => new Date(Date.now() + 60 * 60 * 1000);

const createRequest = (path: string, sessionToken?: string) =>
  new NextRequest(new URL(path, ORIGIN), {
    headers: {
      ...(sessionToken ? { cookie: `session=${sessionToken}` } : {}),
      "user-agent": "NexusChat proxy test",
    },
  });

const runProxy = (path: string, sessionToken?: string) =>
  proxy(createRequest(path, sessionToken));

const mockUserInfo = (
  overrides: Partial<{ id: string; emailVerified: boolean; needsKeyRecovery: boolean }> = {},
) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        id: USER_ID,
        emailVerified: true,
        needsKeyRecovery: false,
        ...overrides,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    ),
  );

const expectNextResponse = (response: NextResponse) => {
  expect(response.status).toBe(200);
  expect(response.headers.get("x-middleware-next")).toBe("1");
  expect(getRedirectUrl(response)).toBeNull();
};

const expectLoginRedirect = (response: NextResponse) => {
  expect(response.status).toBe(307);
  expect(getRedirectUrl(response)).toBe(`${ORIGIN}/auth/login`);
};

describe("Next.js Proxy authentication routing contract", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    vi.stubEnv("NODE_ENV", "test");
    delete process.env.NEXT_PUBLIC_API_URL;

    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    restoreEnvironmentVariable("JWT_SECRET", originalEnvironment.jwtSecret);
    restoreEnvironmentVariable("NODE_ENV", originalEnvironment.nodeEnv);
    restoreEnvironmentVariable("NEXT_PUBLIC_API_URL", originalEnvironment.apiUrl);
  });

  describe("matcher and ignored paths", () => {
    it.each(["/", "/auth/login", "/auth/verification"])(
      "matches application route %s",
      (path) => {
        expect(
          unstable_doesMiddlewareMatch({ config, url: new URL(path, ORIGIN).toString() }),
        ).toBe(true);
      },
    );

    it.each([
      "/api/v1/auth/user",
      "/_next/static/chunk.js",
      "/_next/image?url=%2Favatar.png",
      "/favicon.ico",
      "/robots.txt",
      "/sitemap.xml",
      "/images/avatar.png",
    ])("excludes static or internal route %s", (path) => {
      expect(
        unstable_doesMiddlewareMatch({ config, url: new URL(path, ORIGIN).toString() }),
      ).toBe(false);
    });

    it.each(["/_next/data/build-id/page", "/_vercel/insights", "/public/avatar"])(
      "allows handler-level ignored route %s",
      async (path) => {
        expectNextResponse(await runProxy(path));
      },
    );
  });

  describe("public and protected routes", () => {
    it.each([
      "/auth/login",
      "/auth/signup",
      "/auth/forgot-password",
      "/auth/reset-password",
      "/auth/private-key-recovery-token-verification",
    ])("allows an unauthenticated user to access %s", async (path) => {
      expectNextResponse(await runProxy(path));
    });

    it("redirects a missing session from a protected route and does not preserve its query", async () => {
      const response = await runProxy("/?room=private-room");

      expectLoginRedirect(response);
      expect(response.cookies.get("session")?.value).toBe("");
      expect(response.cookies.get("loggedInUserId")?.value).toBe("");
    });

    it("rejects an invalid session token", async () => {
      expectLoginRedirect(await runProxy("/", "not-a-jwt"));
    });

    it("rejects an expired session token", async () => {
      const token = await signSessionToken({
        userId: USER_ID,
        expiresAt: new Date(Date.now() - 60_000),
      });

      expectLoginRedirect(await runProxy("/", token));
    });

    it("rejects a valid wrong-purpose token", async () => {
      const token = await signPasswordResetToken({ userId: USER_ID, expiresAt: futureExpiry() });

      expectLoginRedirect(await runProxy("/", token));
    });

    it("allows a valid verified session and forwards the bearer token to user-info", async () => {
      process.env.NEXT_PUBLIC_API_URL = API_ORIGIN;
      const token = await signSessionToken({ userId: USER_ID, expiresAt: futureExpiry() });
      const fetchMock = mockUserInfo();

      const response = await runProxy("/", token);

      expectNextResponse(response);
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_ORIGIN}/api/v1/auth/user`,
        expect.objectContaining({
          cache: "no-store",
          headers: expect.objectContaining({
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "User-Agent": "NexusChat proxy test",
          }),
          signal: expect.any(AbortSignal),
        }),
      );
      expect(response.cookies.get("loggedInUserId")?.value).toBe(USER_ID);
    });

    it.each([
      "/auth/login",
      "/auth/signup",
      "/auth/forgot-password",
      "/auth/reset-password",
    ])("redirects an authenticated user away from %s", async (path) => {
      const token = await signSessionToken({ userId: USER_ID, expiresAt: futureExpiry() });
      const fetchMock = vi.spyOn(globalThis, "fetch");

      const response = await runProxy(path, token);

      expect(getRedirectUrl(response)).toBe(`${ORIGIN}/`);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("recovery and verification routes", () => {
    it("allows an authenticated user to remain on private-key recovery verification", async () => {
      const token = await signSessionToken({ userId: USER_ID, expiresAt: futureExpiry() });
      const fetchMock = vi.spyOn(globalThis, "fetch");

      expectNextResponse(
        await runProxy("/auth/private-key-recovery-token-verification", token),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("redirects a protected-route user who needs key recovery", async () => {
      const token = await signSessionToken({ userId: USER_ID, expiresAt: futureExpiry() });
      mockUserInfo({ needsKeyRecovery: true });

      const response = await runProxy("/", token);

      expect(getRedirectUrl(response)).toBe(
        `${ORIGIN}/auth/private-key-recovery-token-verification`,
      );
    });

    it("redirects an unverified user to verification and sets temporary user info", async () => {
      const token = await signSessionToken({ userId: USER_ID, expiresAt: futureExpiry() });
      mockUserInfo({ emailVerified: false });

      const response = await runProxy("/", token);

      expect(getRedirectUrl(response)).toBe(`${ORIGIN}/auth/verification`);
      expect(response.cookies.get("tempUserInfo")?.value).toContain(USER_ID);
    });

    it("allows an unverified user already on verification and retains temporary user info", async () => {
      const token = await signSessionToken({ userId: USER_ID, expiresAt: futureExpiry() });
      mockUserInfo({ emailVerified: false });

      const response = await runProxy("/auth/verification", token);

      expectNextResponse(response);
      expect(response.cookies.get("tempUserInfo")?.value).toContain(USER_ID);
    });
  });

  describe("backend failures, redirects, and cookies", () => {
    it.each([401, 403])("clears authentication cookies after backend status %s", async (status) => {
      vi.stubEnv("NODE_ENV", "production");
      process.env.NEXT_PUBLIC_API_URL = API_ORIGIN;
      const token = await signSessionToken({ userId: USER_ID, expiresAt: futureExpiry() });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status, statusText: "Unauthorized" }),
      );

      const response = await runProxy("/", token);
      const setCookieHeader = response.headers.get("set-cookie") ?? "";

      expectLoginRedirect(response);
      expect(response.cookies.get("session")?.value).toBe("");
      expect(response.cookies.get("loggedInUserId")?.value).toBe("");
      expect(setCookieHeader).toContain("session=;");
      expect(setCookieHeader).toContain("loggedInUserId=;");
      expect(setCookieHeader).toContain("Path=/");
      expect(setCookieHeader).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
      expect(setCookieHeader).toContain("HttpOnly");
      expect(setCookieHeader).toContain("Secure");
      expect(setCookieHeader).toContain("Partitioned");
      expect(setCookieHeader).toContain("SameSite=none");
    });

    it("allows access when the backend connection is refused", async () => {
      vi.useFakeTimers();
      const token = await signSessionToken({ userId: USER_ID, expiresAt: futureExpiry() });
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connect ECONNREFUSED"));

      const response = await runProxy("/", token);

      expectNextResponse(response);
    });

    it("clears authentication after the backend request times out", async () => {
      const token = await signSessionToken({ userId: USER_ID, expiresAt: futureExpiry() });
      vi.useFakeTimers();
      vi.spyOn(globalThis, "fetch").mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted", "AbortError"));
            });
          }),
      );

      const responsePromise = runProxy("/", token);
      await vi.advanceTimersByTimeAsync(5_000);
      const response = await responsePromise;

      expectLoginRedirect(response);
      expect(response.cookies.get("session")?.value).toBe("");
      expect(response.cookies.get("loggedInUserId")?.value).toBe("");
    });

    it("allows a protected route when the production API URL is missing", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.NEXT_PUBLIC_API_URL;
      const token = await signSessionToken({ userId: USER_ID, expiresAt: futureExpiry() });
      const fetchMock = vi.spyOn(globalThis, "fetch");

      const response = await runProxy("/", token);

      expectNextResponse(response);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
