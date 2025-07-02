import { verifyPrivateKeyRecoveryToken } from "@/actions/auth.actions";
import { storeUserPrivateKeyInIndexedDB } from "@/lib/client/indexedDB";
import { FetchUserInfoResponse } from "@/lib/server/services/userService";
import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useState } from "react";
import { useActionState } from "react-dom"; // Correct import for useActionState
import toast from "react-hot-toast";
import { decryptPrivateKey } from "@/lib/client/encryption"; // Ensure correct path

type PropTypes = {
  recoveryToken: string | null;
  // New: Pass the password securely from the component where the user enters it
  // This removes the need for localStorage.getItem("tempPassword")
  passwordInput: string | null;
};

export const useVerifyPrivateKeyRecoveryToken = ({
  recoveryToken,
  passwordInput, // Receive password directly
}: PropTypes) => {
  const [isPrivateKeyRestoredInIndexedDB, setIsPrivateKeyRestoredInIndexedDB] = useState(false);
  const [loggedInUser, setLoggedInUser] = useState<FetchUserInfoResponse | null>(null); // Initialize as null
  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  // useActionState returns [state, action, isPending]
  const [state, verifyPrivateKeyRecoveryTokenAction, isPending] = useActionState(
    verifyPrivateKeyRecoveryToken,
    undefined // Initial state
  );

  const router = useRouter();

  // Effect 1: Try to load loggedInUser from the cookie or server context (if available)
  // Instead of localStorage, you should ideally get this from a server component
  // or a cookie that is passed down. For now, we'll keep localStorage, but it's a weak point.
  useEffect(() => {
    // This part is the most critical for the looping modal.
    // If loggedInUser is not consistently available or correctly set,
    // the action might be re-triggered.
    const getInitialUserData = async () => {
      // Option 1 (Better): Fetch user info from server if not already available
      // This would require an API endpoint or another server action to get user info by session
      // For now, let's keep the localStorage but acknowledge it's a temp solution
      try {
        const userData = localStorage.getItem("loggedInUser");
        if (userData) {
          const parsedUser = JSON.parse(userData) as FetchUserInfoResponse;
          setLoggedInUser(parsedUser);
          console.log('User data loaded from localStorage:', parsedUser);
        } else {
          console.warn('No user data found in localStorage. User might need to log in again.');
          // If no user in localStorage, the recovery can't proceed.
          // This prevents infinite loops if the user isn't genuinely logged in.
          toast.error("User session not found. Please log in.");
          router.push("/auth/login");
        }
      } catch (error) {
        console.error('Error parsing loggedInUser from localStorage:', error);
        toast.error("Error reading user data. Please log in.");
        router.push("/auth/login");
      }
    };
    getInitialUserData();
  }, [router]); // Only run once on mount

  // Effect 2: Trigger the server action once we have recoveryToken and loggedInUser
  useEffect(() => {
    if (loggedInUser?.id && recoveryToken && !state?.data && !isPending) {
      console.log('Triggering verifyPrivateKeyRecoveryTokenAction for user:', loggedInUser.id);
      startTransition(() => {
        verifyPrivateKeyRecoveryTokenAction({
          recoveryToken,
          userId: loggedInUser.id,
        });
      });
    } else {
      console.log('Skipping action trigger:', {
        loggedInUserId: loggedInUser?.id,
        recoveryTokenPresent: !!recoveryToken,
        stateDataPresent: !!state?.data,
        isPending: isPending,
      });
    }
  }, [loggedInUser?.id, recoveryToken, verifyPrivateKeyRecoveryTokenAction, state?.data, isPending]);

  // Effect 3: Handle the result of the server action
  useEffect(() => {
    console.log('Server action state changed:', state);
    if (state?.errors?.message) {
      console.error('Server action error:', state.errors.message);
      toast.error(state.errors.message);
      // It's important to clear any temporary state that might cause re-loops
      localStorage.removeItem("loggedInUser");
      localStorage.removeItem("tempPassword"); // Just in case it was there
      router.push("/auth/login");
      return; // Exit to prevent further processing
    }

    // Only proceed if state.data exists and contains either combinedSecret or privateKey
    if (state?.data && (state.data.combinedSecret || state.data.privateKey)) {
      console.log('Server action returned key data. Setting isSuccess to true.');
      setIsSuccess(true);
    }
  }, [state, router]);

  // Effect 4: Decrypt and store the private key once data is successfully fetched
  // This useCallback is correctly defined and then called inside an effect.
  const handleDecryptAndStorePrivateKey = useCallback(async () => {
    if (!loggedInUser || !state?.data) {
      console.log('handleDecryptAndStorePrivateKey: Missing loggedInUser or state.data');
      return;
    }

    const { combinedSecret, privateKey } = state.data;
    let passwordToUse: string | null = null;

    if (combinedSecret) {
      passwordToUse = combinedSecret;
      console.log('Using combinedSecret as password for decryption.');
    } else if (privateKey) { // privateKey exists means it's encrypted, so passwordInput is needed
      if (passwordInput) {
        passwordToUse = passwordInput;
        console.log('Using passwordInput for decryption.');
      } else {
        toast.error("Password is required to decrypt your private key.");
        console.error('Password input missing for private key decryption.');
        router.push("/auth/login"); // Redirect if password is required but not provided
        return;
      }
    } else {
      toast.error("No private key data received from server.");
      console.error('No privateKey or combinedSecret in state.data');
      router.push("/auth/login");
      return;
    }

    if (passwordToUse && privateKey) {
      try {
        console.log('Attempting to decrypt private key...');
        const privateKeyInJwk = await decryptPrivateKey(
          passwordToUse,
          privateKey
        );
        console.log('Private key decrypted. Storing in IndexedDB...');
        await storeUserPrivateKeyInIndexedDB({
          privateKey: privateKeyInJwk,
          userId: loggedInUser.id,
        });
        console.log('Private key stored in IndexedDB successfully.');

        // Clear temporary data only AFTER successful storage
        localStorage.removeItem("loggedInUser"); // If you're still relying on this
        // localStorage.removeItem("tempPassword"); // This should no longer be used

        setIsPrivateKeyRestoredInIndexedDB(true);
        console.log('setIsPrivateKeyRestoredInIndexedDB set to true.');
      } catch (decryptError) {
        console.error('Error during decryption or IndexedDB storage:', decryptError);
        toast.error("Error recovering private key. Please try again.");
        router.push("/auth/login");
      }
    } else {
      console.warn('handleDecryptAndStorePrivateKey: Missing password or privateKey for decryption.');
      // This case should ideally not be hit if checks above are robust
      toast.error("Missing credentials for key recovery.");
      router.push("/auth/login");
    }
  }, [loggedInUser, state?.data, passwordInput, router]);


  // Effect 5: Trigger the decryption and storage process
  useEffect(() => {
    if (isSuccess && loggedInUser && (state?.data?.combinedSecret || state?.data?.privateKey)) {
      console.log('Calling handleDecryptAndStorePrivateKey due to success state and data.');
      handleDecryptAndStorePrivateKey();
    } else {
      console.log('Waiting for isSuccess, loggedInUser, or key data to call decryption handler.');
    }
  }, [isSuccess, loggedInUser, state?.data, handleDecryptAndStorePrivateKey]); // Depend on the callback itself


  console.log('Current hook return state: isPrivateKeyRestoredInIndexedDB:', isPrivateKeyRestoredInIndexedDB, 'isSuccess:', isSuccess);

  return {
    isPrivateKeyRestoredInIndexedDB: isPrivateKeyRestoredInIndexedDB, // isSuccess check done inside the hook now
    isPending, // Expose isPending for UI feedback
    error: state?.errors?.message, // Expose error message
  };
};
// This hook now handles the entire flow of verifying the recovery token,