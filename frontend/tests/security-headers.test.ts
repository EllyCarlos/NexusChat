import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import {
  createContentSecurityPolicy,
  createSecurityHeaderRules,
} from "../security-headers";

const productionEnvironment = {
  NEXT_PUBLIC_API_URL: "https://api.nexuschat.example",
  NEXT_PUBLIC_BASE_URL: "https://api.nexuschat.example/api/v1",
  NEXT_PUBLIC_ABSOLUTE_BASE_URL: "https://api.nexuschat.example",
};

const headersFor = (source: string, environment = "production") => {
  const rule = createSecurityHeaderRules(environment, productionEnvironment)
    .find((candidate) => candidate.source === source);

  if (!rule) throw new Error(`Missing header rule for ${source}`);
  return new Map(rule.headers.map(({ key, value }) => [key.toLowerCase(), value]));
};

describe("frontend security response headers", () => {
  it("defines the global security headers", () => {
    const headers = headersFor("/:path*");

    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-dns-prefetch-control")).toBe("off");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("defines a document Content Security Policy", () => {
    const csp = headersFor("/:path*").get("content-security-policy");

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/(?:^|\s)\*(?:\s|;|$)/);
  });

  it("does not permit unsafe-eval in production", () => {
    const csp = createContentSecurityPolicy("production", productionEnvironment);

    expect(csp).not.toContain("'unsafe-eval'");
    expect(createContentSecurityPolicy("development", productionEnvironment)).toContain("'unsafe-eval'");
  });

  it.each([
    "https://images.pexels.com",
    "https://res.cloudinary.com",
    "https://lh3.googleusercontent.com",
    "https://media.tenor.com",
    "https://nexuswebapp.vercel.app",
  ])("allows the audited image origin %s", (origin) => {
    expect(headersFor("/:path*").get("content-security-policy")).toContain(origin);
  });

  it("allows exact configured API and Socket origins", () => {
    const csp = headersFor("/:path*").get("content-security-policy");

    expect(csp).toContain("connect-src 'self' https://api.nexuschat.example wss://api.nexuschat.example");
    expect(csp).not.toContain("https://api.nexuschat.example/api/v1");
  });

  it.each([
    "https://tenor.googleapis.com",
    "https://firebaseinstallations.googleapis.com",
    "https://fcmregistrations.googleapis.com",
  ])("allows the audited client connection origin %s", (origin) => {
    expect(headersFor("/:path*").get("content-security-policy")).toContain(origin);
  });

  it("allows Google Fonts styles and font files", () => {
    const csp = headersFor("/:path*").get("content-security-policy");

    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain("font-src 'self' data: https://fonts.gstatic.com");
  });

  it("blocks framing with both CSP and a legacy-compatible header", () => {
    const headers = headersFor("/:path*");

    expect(headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("x-frame-options")).toBe("DENY");
  });

  it("preserves camera and microphone while disabling unused capabilities", () => {
    expect(headersFor("/:path*").get("permissions-policy")).toBe(
      "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), browsing-topics=()",
    );
  });

  it("keeps the OAuth callback on no-referrer", () => {
    expect(headersFor("/auth/oauth-redirect").get("referrer-policy")).toBe("no-referrer");
  });

  it.each(["/auth/:path*", "/api/auth/:path*", "/auth/oauth-redirect"]) (
    "marks %s no-store",
    (source) => {
      expect(headersFor(source).get("cache-control")).toBe("no-store");
    },
  );

  it("emits conservative HSTS only in production", () => {
    expect(headersFor("/:path*").get("strict-transport-security")).toBe("max-age=31536000");
    expect(headersFor("/:path*", "development").get("strict-transport-security")).toBeUndefined();
  });

  it("suppresses the Next.js powered-by header", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("does not enable cross-origin isolation headers", () => {
    const headers = headersFor("/:path*");

    expect(headers.has("cross-origin-embedder-policy")).toBe(false);
    expect(headers.has("cross-origin-opener-policy")).toBe(false);
    expect(headers.has("cross-origin-resource-policy")).toBe(false);
  });
});
