import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    domains: [
      "images.pexels.com",
      "res.cloudinary.com",
      "lh3.googleusercontent.com", 
      "media.tenor.com"
    ],
  },
  reactStrictMode:false
};

export default nextConfig;
