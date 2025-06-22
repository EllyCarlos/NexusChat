// frontend/src/app/auth/login/layout.tsx
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login - NexusChat",
  description: "Securely log in to NexusChat, a privacy-focused encrypted chat app.",
  keywords: [
    "NexusChat login",
    "secure chat login",
    "encrypted messaging",
    "private chat login",
    "end-to-end encryption login"
  ],
  openGraph: {
    title: "Login - NexusChat",
    description: "Securely log in to NexusChat, a privacy-focused encrypted chat app.",
    url: "https://nexuswebapp.vercel.app/auth/login",
    siteName: "NexusChat",
    type: "website",
    images: [
      {
        url: "https://nexuswebapp.vercel.app/images/og/og-image.png",
        width: 1200,
        height: 630,
        alt: "NexusChat - Secure & Encrypted Chat App",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Login - NexusChat",
    description: "Securely log in to NexusChat, a privacy-focused encrypted chat app.",
    images: ["https://nexuswebapp.vercel.app/images/og/og-image.png"],
  },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}