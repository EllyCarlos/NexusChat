'use client';

import { LoginForm } from "@/components/auth/LoginForm";
import { SocialLogin } from "@/components/auth/SocialLogin";
import { useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";
import toast from "react-hot-toast";

function LoginPageContent() {
  const searchParams = useSearchParams();
 
  // Handle OAuth errors redirected from oauth-redirect page
  useEffect(() => {
    const error = searchParams.get('error');
    if (error) {
      toast.error(`Authentication failed: ${decodeURIComponent(error)}`);
      // Clean up URL
      window.history.replaceState({}, '', '/auth/login');
    }
  }, [searchParams]);

  return (
    <>
      <div className="flex flex-col gap-y-8">
        <h3 className="text-4xl font-bold text-fluid-h3">Login</h3>
        <SocialLogin googleLink={`${process.env.NEXT_PUBLIC_BASE_URL}/auth/google`} />
      </div>
      <LoginForm />
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginPageContent />
    </Suspense>
  );
}