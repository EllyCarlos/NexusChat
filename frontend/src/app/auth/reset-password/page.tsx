"use client";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function ResetPasswordPageContent (){

  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  useEffect(() => {
    if (!token)router.push("/auth/login");
  }, [token,router]);

  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-col gap-y-3">
        <h3 className="text-4xl text-fluid-h3 font-bold">
          Reset your password
        </h3>
        <p className="text-lg text-fluid-p">
          Once your password is reset you can login with your new password
        </p>
      </div>

      <div>
        {token && (
          <ResetPasswordForm token={token}/>
        )}
      </div>
    </div>
  );
};

export default function Page(){
  return (
    <Suspense fallback={<span>Loading...</span>}>
      <ResetPasswordPageContent/>
    </Suspense>
  )
};
