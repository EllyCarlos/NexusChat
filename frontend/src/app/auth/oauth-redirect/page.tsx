'use client';
import { useDispatch } from 'react-redux';
import { setAuthToken } from '@/lib/client/slices/authSlice'; // Adjust path if necessary
import { verifyOAuthToken } from '@/actions/auth.actions'; // Ensure this action points to your backend verification
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
  const [isProcessing, setIsProcessing] = useState<boolean>(false); // Flag to prevent re-triggering
  const router = useRouter();
  const dispatch = useDispatch();

  // Step 1: Trigger token verification
  useEffect(() => {
    if (token && !isProcessing) { // Ensure token exists and we're not already processing
      console.log('Starting OAuth token verification');
      setIsProcessing(true); // Set processing to true immediately

      startTransition(() => {
        verifyOAuthTokenAction(token);
      });
    }
  }, [token, verifyOAuthTokenAction, isProcessing]); // Depend on isProcessing to prevent re-trigger on state change

  // Step 2: Handle response and store token
  useEffect(() => {
    if (state) {
      console.log('OAuth verification state received:', {
        hasError: !!state.errors?.message,
        hasUser: !!state?.data?.user,
        hasCombinedSecret: !!state?.data?.combinedSecret,
        hasSessionToken: !!state?.data?.sessionToken // More concise check
      });

      // Reset processing flag when state is received, regardless of success or error
      setIsProcessing(false); 

      // Handle errors
      if (state.errors?.message) {
        console.error('OAuth verification failed:', state.errors.message);
        toast.error(`Authentication failed: ${state.errors.message}`);
        router.push(`/auth/login?error=${encodeURIComponent(state.errors.message)}`);
        return;
      }

      // Handle successful authentication
      if (state?.data?.user && state?.data?.sessionToken) { // Ensure user and sessionToken exist
        const sessionToken = state.data.sessionToken;
        if (sessionToken) {
          dispatch(setAuthToken(sessionToken));
        }

        // Clear the temp token from URL immediately for security
        const newUrl = window.location.pathname;
        window.history.replaceState({}, '', newUrl);

        // Check if this is a new user (has combinedSecret)
        if (state.data.combinedSecret) {
          toast.success('Welcome! Setting up your account...');
          setOAuthNewUser(true);
        } else {
          toast.success('Successfully logged in!'); // Changed message for existing users
          // For existing users, redirect immediately
          setTimeout(() => {
            router.push('/');
          }, 1000);
        }
      }
    }
  }, [state, router, dispatch]);

  // Step 3: Key generation for new users (your existing logic is perfect!)
  // password here refers to the combinedSecret for initial key derivation
  const password = state?.data?.combinedSecret;
  const userId = state?.data?.user?.id;

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
      // Redirect to login after showing error
      setTimeout(() => {
        router.push('/auth/login');
      }, 3000);
    }
  }, [errorParam, router]);

  return (
    <div className="bg-background w-full h-full text-text text-xl flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
        <p className="mb-2">
          {isProcessing ? 'Verifying authentication...' : 
            isOAuthNewUser ? 'Setting up your account...' : 
            'Redirecting, please wait...'}
        </p>
        
        {isOAuthNewUser && (
          <p className="text-sm text-gray-600">
            Generating your encryption keys...
          </p>
        )}
        
        {state?.errors?.message && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-700 text-sm">
              Error: {state.errors.message}
            </p>
            <p className="text-red-500 text-xs mt-1">
              Redirecting to login...
            </p>
          </div>
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
// This page handles the OAuth redirect and processes the authentication token.
// It verifies the token, manages user state, and handles new user key generation.