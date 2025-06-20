import { AuthRedirectLink } from "@/components/auth/AuthRedirectLink";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { Metadata } from "next";


export const metadata: Metadata = {
  title: "Forgot Password - NexusChat",
  description: "Forgot your password? Reset it securely on NexusChat and regain access to your account.",
  keywords: [
    "NexusChat password reset", 
    "forgot password", 
    "reset password", 
    "recover account", 
    "secure password reset"
  ],
  openGraph: {
    title: "Forgot Password - NexusChat",
    description: "Forgot your password? Reset it securely on NexusChat and regain access to your account.",
    url: "https://nexuswebapp.vercel.app/auth/forgot-password",
    siteName: "NexusChat",
    type: "website",
    images: [
      {
        url: "https://nexuswebapp.vercel.app/images/og/og-image.png", // Update with your actual OG image
        width: 1200,
        height: 630,
        alt: "NexusChat - Secure & Encrypted Chat App",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Forgot Password - NexusChat",
    description: "Forgot your password? Reset it securely on NexusChat and regain access to your account.",
    images: ["https://nexuswebapp.vercel.app/images/og/og-image.png"], // Update with your actual Twitter image
  },
};


const page = () => {
  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-col gap-y-3">
        <h3 className="text-4xl text-fluid-h3 font-bold">Let us help you</h3>
        <p className="text-lg text-fluid-p">
          You&apos;ll receive a password reset link if your email is registered
          with us
        </p>
      </div>
      <ForgotPasswordForm />
      <AuthRedirectLink pageName="Login" text="Go back?" to="auth/login" />
    </div>
  );
};

export default page;
