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
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const router = useRouter();

  // Step 1: Trigger token verification
  useEffect(() => {
    if (token && !isProcessing) {
      console.log('Starting OAuth token verification');
      setIsProcessing(true);
      
      startTransition(() => {
        verifyOAuthTokenAction(token);
      });
    }
  }, [token, verifyOAuthTokenAction, isProcessing]);

  // Step 2: Handle response and store token
  useEffect(() => {
    if (state) {
      console.log('OAuth verification state received:', {
        hasError: !!state.error,
        hasUser: !!state?.data?.user,
        hasCombinedSecret: !!state?.data?.combinedSecret,
        isNewUser: state?.data?.isNewUser
      });

      // Handle errors
      if (state.error) {
        console.error('OAuth verification failed:', state.error);
        toast.error(`Authentication failed: ${state.error}`);
        // Redirect to login with error
        router.push(`/auth/login?error=${encodeURIComponent(state.error)}`);
        return;
      }

      // Handle successful authentication
      if (state?.data?.user) {
        // ✅ Store JWT token in localStorage
        if (token) {
          localStorage.setItem('token', token);
        }

        if (state.data.combinedSecret && state.data.isNewUser) {
          toast.success('Welcome! Setting up your account...');
          setOAuthNewUser(true);
        } else {
          toast.success('Welcome back!');
          // For existing users, redirect immediately
          setTimeout(() => {
            router.push('/');
          }, 1000);
        }
      }
    }
  }, [state, token, router]);

  // Step 3: If new user, generate and encrypt key pair using combinedSecret
  const password = state?.data?.combinedSecret;
  const userId = state?.data?.user?.id;

  // Only trigger key generation for new users
  const { privateKey, publicKey } = useGenerateKeyPair({ 
    user: isOAuthNewUser && !!password 
  });

  const { privateKeyJWK, publicKeyJWK } = useConvertPrivateAndPublicKeyInJwkFormat({ 
    privateKey, 
    publicKey 
  });

  const { encryptedPrivateKey } = useEncryptPrivateKeyWithUserPassword({ 
    password, 
    privateKeyJWK 
  });

  const { publicKeyReturnedFromServerAfterBeingStored } = useStoreUserKeysInDatabase({
    encryptedPrivateKey,
    publicKeyJWK,
    loggedInUserId: userId,
  });

  useStoreUserPrivateKeyInIndexedDB({
    privateKey: privateKeyJWK,
    userId: userId,
  });

  useUpdateLoggedInUserPublicKeyInState({
    publicKey: publicKeyReturnedFromServerAfterBeingStored,
  });

  // Handle completion of key setup for new users
  useEffect(() => {
    if (isOAuthNewUser && publicKeyReturnedFromServerAfterBeingStored) {
      toast.success('Account setup complete!');
      setTimeout(() => {
        router.push('/');
      }, 1500);
    }
  }, [isOAuthNewUser, publicKeyReturnedFromServerAfterBeingStored, router]);

  // Handle URL parameters for error display
  const errorParam = searchParams.get('error');
  useEffect(() => {
    if (errorParam) {
      toast.error(`Authentication error: ${decodeURIComponent(errorParam)}`);
    }
  }, [errorParam]);

  return (
    <div className="bg-background w-full h-full text-text text-xl flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
        <p>
          {isProcessing ? 'Verifying authentication...' : 
           isOAuthNewUser ? 'Setting up your account...' : 
           'Redirecting, please wait...'}
        </p>
        {state?.error && (
          <p className="text-red-500 mt-2 text-sm">
            Error: {state.error}
          </p>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={
      <div className="bg-background w-full h-full text-text text-xl flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Loading...</p>
        </div>
      </div>
    }>
      <OAuthRedirectPageContent />
    </Suspense>
  );
}
