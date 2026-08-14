import { verifyPrivateKeyRecoveryToken } from "@/actions/auth.actions";
import { storeUserPrivateKeyInIndexedDB } from "@/lib/client/indexedDB";
import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import toast from "react-hot-toast";
import { decryptPrivateKey } from "@/lib/client/encryption";
import { decryptPrivateKeyV2 } from "@/lib/client/privateKeyEnvelope";

type PropTypes = {
  recoveryToken: string | null;
  passwordInput: string | null;
  enabled: boolean;
};

export const useVerifyPrivateKeyRecoveryToken = ({
  recoveryToken,
  passwordInput,
  enabled,
}: PropTypes) => {
  const [isPrivateKeyRestoredInIndexedDB, setIsPrivateKeyRestoredInIndexedDB] = useState(false);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const verificationStartedRef = useRef(false);

  // useActionState returns [state, action, isPending]
  const [state, verifyPrivateKeyRecoveryTokenAction, isPending] = useActionState(
    verifyPrivateKeyRecoveryToken,
    undefined // Initial state
  );

  const router = useRouter();

  // Effect 1: Trigger the server action after the recovery form is submitted
  useEffect(() => {
    if (
      !verificationStartedRef.current &&
      enabled &&
      recoveryToken &&
      passwordInput?.trim() &&
      !state?.data &&
      !isPending
    ) {
      verificationStartedRef.current = true;
      startTransition(() => {
        verifyPrivateKeyRecoveryTokenAction({
          recoveryToken,
        });
      });
    }
  }, [enabled, passwordInput, recoveryToken, verifyPrivateKeyRecoveryTokenAction, state?.data, isPending]);

  // Effect 2: Handle the result of the server action
  useEffect(() => {
    if (state?.errors?.message) {
      toast.error(state.errors.message);
      // Clear legacy recovery data written by older clients.
      localStorage.removeItem("loggedInUser");
      localStorage.removeItem("tempPassword");
      router.push("/auth/login");
      return; // Exit to prevent further processing
    }

    if (state?.data) {
      setIsSuccess(true);
    }
  }, [state, router]);

  // Effect 3: Decrypt and store the private key once data is successfully fetched
  // This useCallback is correctly defined and then called inside an effect.
  const handleDecryptAndStorePrivateKey = useCallback(async () => {
    if (!state?.data) {
      return;
    }

    const { privateKey, recoveryMode, userId } = state.data;

    try {
      let privateKeyInJwk: JsonWebKey | null | undefined;

      if (recoveryMode === "oauth-v2") {
        privateKeyInJwk = await decryptPrivateKeyV2({
          envelope: privateKey,
          recoverySecret: state.data.recoverySecret,
        });
      } else {
        const passwordToUse =
          recoveryMode === "oauth-v1"
            ? state.data.combinedSecret
            : passwordInput;
        if (!passwordToUse) {
          throw new Error("Missing recovery credential.");
        }
        privateKeyInJwk = await decryptPrivateKey(passwordToUse, privateKey);
      }

      if (!privateKeyInJwk) {
        throw new Error("Private-key decryption failed.");
      }

      await storeUserPrivateKeyInIndexedDB({
        privateKey: privateKeyInJwk,
        userId,
      });

      // Clear legacy recovery data only AFTER successful storage.
      localStorage.removeItem("loggedInUser");
      setIsPrivateKeyRestoredInIndexedDB(true);
    } catch {
      console.error("Private-key recovery failed.");
      toast.error("Error recovering private key. Please try again.");
      router.push("/auth/login");
    }
  }, [state?.data, passwordInput, router]);


  // Effect 4: Trigger the decryption and storage process
  useEffect(() => {
    if (isSuccess && state?.data) {
      handleDecryptAndStorePrivateKey();
    }
  }, [isSuccess, state?.data, handleDecryptAndStorePrivateKey]); // Depend on the callback itself

  return {
    isPrivateKeyRestoredInIndexedDB: isPrivateKeyRestoredInIndexedDB, // isSuccess check done inside the hook now
    isPending, // Expose isPending for UI feedback
    error: state?.errors?.message, // Expose error message
  };
};
