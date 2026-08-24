'use client';
import { useDispatch } from 'react-redux';
import { setAuthToken } from '@/lib/client/slices/authSlice'; // Adjust path if necessary
import { verifyOAuthToken } from '@/actions/auth.actions'; // Ensure this action points to your backend verification
import { useConvertPrivateAndPublicKeyInJwkFormat } from '@/hooks/useAuth/useConvertPrivateAndPublicKeyInJwkFormat';
import { useEncryptPrivateKeyV2 } from '@/hooks/useAuth/useEncryptPrivateKeyV2';
import { useGenerateKeyPair } from '@/hooks/useAuth/useGenerateKeyPair';
import { useMigrateOAuthPrivateKeyBackupToV2 } from '@/hooks/useAuth/useMigrateOAuthPrivateKeyBackupToV2';
import { useStoreNewOAuthV2UserKeys } from '@/hooks/useAuth/useStoreNewOAuthV2UserKeys';
import { useStoreUserPrivateKeyInIndexedDB } from '@/hooks/useAuth/useStoreUserPrivateKeyInIndexedDB';
import { useUpdateLoggedInUserPublicKeyInState } from '@/hooks/useAuth/useUpdateLoggedInUserPublicKeyInState';
import { readAndScrubOAuthExchangeToken } from '@/lib/client/oauthRedirect';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  startTransition,
  Suspense,
  useActionState,
  useEffect,
  useRef,
  useState
} from 'react';
import toast from 'react-hot-toast';

function OAuthRedirectPageContent() {
  const [state, verifyOAuthTokenAction] = useActionState(verifyOAuthToken, undefined);
  const searchParams = useSearchParams();
  const errorParam = searchParams.get('error');
  const [exchangeToken, setExchangeToken] = useState<string | null>(null);
  const [isOAuthNewUser, setOAuthNewUser] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const oauthVerificationStartedRef = useRef(false);
  const migrationResultHandledRef = useRef(false);
  const router = useRouter();
  const dispatch = useDispatch();

  // Step 1: Capture the fragment token and scrub it before verification or key work.
  useEffect(() => {
    const token = readAndScrubOAuthExchangeToken({
      location: window.location,
      history: window.history,
    });

    if (errorParam) {
      return;
    }

    if (!token) {
      router.replace('/auth/login?error=oauth_exchange_missing');
      return;
    }

    setExchangeToken(token);
  }, [errorParam, router]);

  // Step 2: Trigger token verification after the browser URL is clean.
  useEffect(() => {
    if (exchangeToken && !oauthVerificationStartedRef.current) {
      oauthVerificationStartedRef.current = true;
      setIsProcessing(true); // Set processing to true immediately

      startTransition(() => {
        verifyOAuthTokenAction(exchangeToken);
      });
      setExchangeToken(null);
    }
  }, [exchangeToken, verifyOAuthTokenAction]);

  // Step 3: Handle response and store token
  useEffect(() => {
    if (state) {
      // Reset processing flag when state is received, regardless of success or error
      setIsProcessing(false);

      // Handle errors
      if (state.errors?.message) {
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

        if (state.data.oauthSetup) {
          toast.success('Welcome! Setting up your account...');
          setOAuthNewUser(true);
        } else if (state.data.oauthMigration) {
          setIsProcessing(true);
        } else if (state.data.oauthMigrationError) {
          toast.error('Private-key backup migration was not completed.');
          router.push('/');
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

  // Step 4: Generate and provision keys only when the server issues V2 setup material.
  const oauthSetup = state?.data?.oauthSetup;
  const oauthMigration = state?.data?.oauthMigration;
  const userId = state?.data?.user?.id;

  const { status: oauthMigrationStatus } =
    useMigrateOAuthPrivateKeyBackupToV2({
      userId,
      migration: oauthMigration,
    });

  useEffect(() => {
    if (
      migrationResultHandledRef.current ||
      !["skipped", "succeeded", "failed"].includes(oauthMigrationStatus)
    ) {
      return;
    }

    migrationResultHandledRef.current = true;
    setIsProcessing(false);
    if (oauthMigrationStatus === "failed") {
      toast.error('Private-key backup migration was not completed.');
    } else {
      toast.success('Successfully logged in!');
    }
    router.push('/');
  }, [oauthMigrationStatus, router]);

  const { privateKey, publicKey } = useGenerateKeyPair({
    user: isOAuthNewUser && !!oauthSetup
  });

  const { privateKeyJWK, publicKeyJWK } = useConvertPrivateAndPublicKeyInJwkFormat({ 
    privateKey, 
    publicKey 
  });

  const { encryptedPrivateKey, encryptionError } = useEncryptPrivateKeyV2({
    privateKeyJWK,
    recoverySecret: oauthSetup?.recoverySecret,
    recoveryKeyWrap: oauthSetup?.recoveryKeyWrap,
  });

  const {
    publicKeyReturnedFromServerAfterBeingStored,
    provisioningError,
    provisioningSucceeded,
  } = useStoreNewOAuthV2UserKeys({
    encryptedPrivateKey,
    publicKeyJWK,
  });

  useStoreUserPrivateKeyInIndexedDB({
    privateKey: provisioningSucceeded ? privateKeyJWK : null,
    userId: userId,
  });

  useUpdateLoggedInUserPublicKeyInState({
    publicKey: publicKeyReturnedFromServerAfterBeingStored,
  });

  useEffect(() => {
    const setupError = encryptionError || provisioningError;
    if (setupError) {
      toast.error(setupError);
      router.push('/auth/login');
    }
  }, [encryptionError, provisioningError, router]);

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
