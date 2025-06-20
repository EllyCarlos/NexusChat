import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/auth/forgot-password",
          "/auth/login",
          "/auth/signup",
        ],
        disallow: [
          "/auth/oauth-redirect",
          "/auth/private-key-recovery-token-verification",
          "/auth/private-key-restoration-success",
          "/auth/reset-password",
          "/auth/verification",
        ],
      },
    ],
    sitemap: "https://nexuswebapp.vercel.app/sitemap.xml",
  };
}
