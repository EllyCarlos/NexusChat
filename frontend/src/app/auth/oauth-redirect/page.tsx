'use client';

import { verifyOAuthToken } from '@/actions/auth.actions';
import { useConvertPrivateAndPublicKeyInJwkFormat } from '@/hooks/useAuth/useConvertPrivateAndPublicKeyInJwkFormat';
import { useEncryptPrivateKeyWithUserPassword } from '@/hooks/useAuth/useEncryptPrivateKeyWithUserPassword';
import { useGenerateKeyPair } from '@/hooks/useAuth/useGenerateKeyPair';
import { useStoreUserKeysInDatabase } from '@/hooks/useAuth/useStoreUserKeysInDatabase';
import { useStoreUserPrivateKeyInIndexedDB } from '@/hooks/useAuth/useStoreUserPrivateKeyInIndexedDB';
import { useUpdateLoggedInUserPublicKeyInState } from '@/hooks/useAuth/useUpdateLoggedInUserPublicKeyInState';
import { useRouter, useSearchParams } from 'next/navigation';

import {
  startTransition,
  Suspense,
  useActionState,
  useEffect,
  useState
} from 'react';
import toast from 'react-hot-toast';

function OAuthRedirectPageContent() {
  const [state, verifyOAuthTokenAction] = useActionState(verifyOAuthToken, undefined);
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [isOAuthNewUser, setOAuthNewUser] = useState<boolean>(false);
  const router = useRouter();

  // Step 1: Trigger token verification
  useEffect(() => {
    if (token) {
      startTransition(() => {
        verifyOAuthTokenAction(token);
      });
    }
  }, [token]);

  // Step 2: Handle response and store token
  useEffect(() => {
    if (state?.data?.combinedSecret || state?.data?.user) {
      // ✅ Store JWT token in localStorage
      if (token) {
        localStorage.setItem('token', token);
      }

      if (state.data.combinedSecret) {
        toast.success('User signup successful');
        setOAuthNewUser(true);
      } else {
        toast.success('Welcome Back');
        router.push('/');
      }
    }
  }, [state, token, router]);

  // Step 3: If new user, generate and encrypt key pair using combinedSecret
  const password = state?.data?.combinedSecret;

  const { privateKey, publicKey } = useGenerateKeyPair({ user: isOAuthNewUser });
  const { privateKeyJWK, publicKeyJWK } = useConvertPrivateAndPublicKeyInJwkFormat({ privateKey, publicKey });
  const { encryptedPrivateKey } = useEncryptPrivateKeyWithUserPassword({ password, privateKeyJWK });
  const { publicKeyReturnedFromServerAfterBeingStored } = useStoreUserKeysInDatabase({
    encryptedPrivateKey,
    publicKeyJWK,
    loggedInUserId: state?.data?.user.id,
  });

  useStoreUserPrivateKeyInIndexedDB({
    privateKey: privateKeyJWK,
    userId: state?.data?.user.id,
  });

  useUpdateLoggedInUserPublicKeyInState({
    publicKey: publicKeyReturnedFromServerAfterBeingStored,
  });

  return (
    <div className="bg-background w-full h-full text-text text-xl">
      Redirecting, please wait...
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <OAuthRedirectPageContent />
    </Suspense>
  );
}
