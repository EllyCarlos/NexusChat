import { storeNewOAuthV2UserKeys } from "@/actions/auth.actions";
import { startTransition, useActionState, useEffect, useRef } from "react";

type PropTypes = {
  encryptedPrivateKey: string | null;
  publicKeyJWK: JsonWebKey | null;
};

export const useStoreNewOAuthV2UserKeys = ({
  encryptedPrivateKey,
  publicKeyJWK,
}: PropTypes) => {
  const [state, storeNewOAuthV2UserKeysAction] = useActionState(
    storeNewOAuthV2UserKeys,
    undefined
  );
  const provisioningStartedRef = useRef(false);

  useEffect(() => {
    if (
      provisioningStartedRef.current ||
      !encryptedPrivateKey ||
      !publicKeyJWK
    ) {
      return;
    }

    provisioningStartedRef.current = true;
    startTransition(() => {
      storeNewOAuthV2UserKeysAction({
        privateKey: encryptedPrivateKey,
        publicKey: publicKeyJWK,
      });
    });
  }, [
    encryptedPrivateKey,
    publicKeyJWK,
    storeNewOAuthV2UserKeysAction,
  ]);

  return {
    publicKeyReturnedFromServerAfterBeingStored: state?.data?.publicKey,
    provisioningError: state?.errors?.message,
    provisioningSucceeded:
      state?.errors?.message === null &&
      typeof state?.data?.publicKey === "string",
  };
};
