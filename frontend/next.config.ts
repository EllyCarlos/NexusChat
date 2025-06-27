import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Basic config */
  images: {
    domains: [
      "images.pexels.com",
      "res.cloudinary.com",
      "lh3.googleusercontent.com",
      "media.tenor.com"
    ],
  },
  reactStrictMode: false,
 
  /* ESLint configuration - ignore during builds */
  eslint: {
    ignoreDuringBuilds: true,
  },
 
  /* Production optimizations */
  compress: true,
  poweredByHeader: false,
 
  /* Environment variables for client-side */
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  },
  /* Optional: For better performance */
  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns']
  }
};

export default nextConfig;