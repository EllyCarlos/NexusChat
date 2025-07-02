import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/", // Allow crawling of the homepage/chat page
          "/auth/forgot-password",
          "/auth/login",
          "/auth/signup",
          // Consider allowing other public-facing content pages if they exist
        ],
        disallow: [
          // Disallow sensitive or temporary pages
          "/auth/oauth-redirect", // Temporary redirect page
          "/auth/private-key-recovery-token-verification", // Sensitive recovery link page
          "/auth/private-key-restoration-success", // Page shown after successful recovery
          "/auth/reset-password", // Password reset page (sensitive)
          "/auth/verification", // Email verification page (sensitive/temporary)
          // Disallow API routes (though they are usually excluded by default)
          "/api/", // Disallow all API routes
        ],
      },
    ],
    // Ensure this sitemap URL is correct for your deployed application
    sitemap: "https://nexuswebapp.vercel.app/sitemap.xml",
  };
}