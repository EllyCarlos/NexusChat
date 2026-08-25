import type { NextConfig } from "next";
import { createSecurityHeaderRules } from "./security-headers";

const nextConfig: NextConfig = {
  /* Basic config */
  async headers() {
    return createSecurityHeaderRules(process.env.NODE_ENV, process.env);
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.pexels.com" },
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "media.tenor.com" },
    ],
  },
  reactStrictMode: false,
 
  /* Production optimizations */
  compress: true,
  poweredByHeader: false,
 
  /* Environment variables for client-side */
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  },
  /* Optional: For better performance */
  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns']
  }
};

export default nextConfig;
