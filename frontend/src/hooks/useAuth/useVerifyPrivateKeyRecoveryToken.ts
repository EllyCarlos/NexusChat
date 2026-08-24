import {
  prepareOAuthPrivateKeyBackupV2Migration,
  verifyPrivateKeyRecoveryToken,
} from "@/actions/auth.actions";
import { storeUserPrivateKeyInIndexedDB } from "@/lib/client/indexedDB";
import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import toast from "react-hot-toast";
import { decryptPrivateKey } from "@/lib/client/encryption";
import {
  decryptPrivateKeyV2,
  validateNexusChatPrivateJsonWebKey,
} from "@/lib/client/privateKeyEnvelope";
import { useMigrateOAuthPrivateKeyBackupToV2 } from "@/hooks/useAuth/useMigrateOAuthPrivateKeyBackupToV2";

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
  const [recoveredOAuthV1PrivateKey, setRecoveredOAuthV1PrivateKey] =
    useState<JsonWebKey | null>(null);
  const verificationStartedRef = useRef(false);
  const recoveryProcessingStartedRef = useRef(false);
  const migrationPreparationStartedRef = useRef(false);
  const migrationResultHandledRef = useRef(false);

  // useActionState returns [state, action, isPending]
  const [state, verifyPrivateKeyRecoveryTokenAction, isPending] = useActionState(
    verifyPrivateKeyRecoveryToken,
    undefined // Initial state
  );
  const [migrationPreparationState, prepareMigrationAction] = useActionState(
    prepareOAuthPrivateKeyBackupV2Migration,
    undefined
  );

  const router = useRouter();
  const oauthV1RecoveryData =
    state?.data?.recoveryMode === "oauth-v1" ? state.data : null;
  const { status: migrationStatus } = useMigrateOAuthPrivateKeyBackupToV2({
    userId: oauthV1RecoveryData?.userId,
    migration: recoveredOAuthV1PrivateKey
      ? migrationPreparationState?.data
      : null,
    privateKey: recoveredOAuthV1PrivateKey ?? undefined,
  });

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
        if (recoveryMode === "oauth-v1") {
          privateKeyInJwk = await validateNexusChatPrivateJsonWebKey(
            privateKeyInJwk
          );
        }
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
      if (recoveryMode === "oauth-v1") {
        setRecoveredOAuthV1PrivateKey(privateKeyInJwk);
        if (!migrationPreparationStartedRef.current) {
          migrationPreparationStartedRef.current = true;
          startTransition(() => {
            prepareMigrationAction();
          });
        }
        return;
      }

      setIsPrivateKeyRestoredInIndexedDB(true);
    } catch {
      console.error("Private-key recovery failed.");
      toast.error("Error recovering private key. Please try again.");
      router.push("/auth/login");
    }
  }, [state, passwordInput, prepareMigrationAction, router]);


  // Effect 4: Trigger the decryption and storage process
  useEffect(() => {
    if (
      state?.data &&
      !recoveryProcessingStartedRef.current
    ) {
      recoveryProcessingStartedRef.current = true;
      void handleDecryptAndStorePrivateKey();
    }
  }, [state?.data, handleDecryptAndStorePrivateKey]); // Depend on the callback itself

  // Effect 5: Finish a successful oauth-v1 recovery regardless of migration outcome.
  const preparationFailed = !!migrationPreparationState?.errors?.message;
  const preparationSkipped =
    migrationPreparationState !== undefined &&
    !migrationPreparationState.errors?.message &&
    !migrationPreparationState.data;
  const migrationFinished =
    migrationStatus === "succeeded" ||
    migrationStatus === "failed" ||
    migrationStatus === "skipped";
  const oauthV1RecoveryFinished = Boolean(
    recoveredOAuthV1PrivateKey &&
    (preparationFailed || preparationSkipped || migrationFinished)
  );

  useEffect(() => {
    if (!oauthV1RecoveryFinished || migrationResultHandledRef.current) {
      return;
    }

    migrationResultHandledRef.current = true;
    if (preparationFailed || migrationStatus === "failed") {
      toast.error("Private-key backup migration was not completed.");
    }
  }, [migrationStatus, oauthV1RecoveryFinished, preparationFailed]);

  return {
    isPrivateKeyRestoredInIndexedDB:
      isPrivateKeyRestoredInIndexedDB || oauthV1RecoveryFinished,
    isPending, // Expose isPending for UI feedback
    error: state?.errors?.message, // Expose error message
  };
};
