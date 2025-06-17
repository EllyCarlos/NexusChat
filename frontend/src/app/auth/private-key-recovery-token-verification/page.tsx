'use client';
import useNavigateToRecoverySuccessfulPageOnPrivateKeyRestoration from "@/hooks/useAuth/useNavigateToRecoverySuccessfulPageOnPrivateKeyRestoration";
import { useVerifyPrivateKeyRecoveryToken } from "@/hooks/useAuth/useVerifyPrivateKeyRecoveryToken";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function PrivateKeyRecoveryTokenVerificationPageContent() {

    const searchParams = useSearchParams()
    const token = searchParams.get('token');

    const {isPrivateKeyRestoredInIndexedDB} = useVerifyPrivateKeyRecoveryToken({recoveryToken:token});
    useNavigateToRecoverySuccessfulPageOnPrivateKeyRestoration({isPrivateKeyRestoredInIndexedDB});

  return (
    <span>Verifying link....</span>
  )
}

export default function Page(){
  return (
    <Suspense fallback={<span>Loading...</span>}>
      <PrivateKeyRecoveryTokenVerificationPageContent/>
    </Suspense>
  )
}
