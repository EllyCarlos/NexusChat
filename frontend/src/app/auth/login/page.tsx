import { LoginForm } from "@/components/auth/LoginForm";
import { SocialLogin } from "@/components/auth/SocialLogin";
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
    url: "https://NexusChat.in/auth/login",
    siteName: "NexusChat",
    type: "website",
    images: [
      {
        url: "https://NexusChat.in/images/og/og-image.png", // Update with your actual OG image
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
    images: ["https://NexusChat.in/images/og/og-image.png"], // Update with your actual Twitter image
  },
};


export default function LoginPage() {


  return (
    <>
    <div className="flex flex-col gap-y-8">
      <h3 className="text-4xl font-bold text-fluid-h3">Login</h3>
      <SocialLogin googleLink={`${process.env.NEXT_PUBLIC_BASE_URL}/auth/google`} />
    </div>
    <LoginForm/>
    </>
  );
}
