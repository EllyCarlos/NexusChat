import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(); // Auto-update last modified date

  return [
    // Core pages
    {
      url: "https://mernchat.in",
      lastModified,
      changeFrequency: "daily",
      priority: 1.0, // Highest priority (homepage)
    },
    // Auth routes that should be indexed
    {
      url: "https://mernchat.in/auth/forgot-password",
      lastModified,
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: "https://mernchat.in/auth/login",
      lastModified,
      changeFrequency: "yearly",
      priority: 0.6,
    },
    {
      url: "https://mernchat.in/auth/signup",
      lastModified,
      changeFrequency: "yearly",
      priority: 0.7,
    },
  ];
}
