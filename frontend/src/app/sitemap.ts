import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(); // Auto-update last modified date

  return [
    // Core pages
    {
      url: "https://nexuswebapp.vercel.app",
      lastModified,
      changeFrequency: "daily",
      priority: 1.0, // Highest priority (homepage)
    },
    // Auth routes that should be indexed
    {
      url: "https://nexuswebapp.vercel.app/auth/forgot-password",
      lastModified,
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: "https://nexuswebapp.vercel.app/auth/login",
      lastModified,
      changeFrequency: "yearly",
      priority: 0.6,
    },
    {
      url: "https://nexuswebapp.vercel.app/auth/signup",
      lastModified,
      changeFrequency: "yearly",
      priority: 0.7,
    },
  ];
}
