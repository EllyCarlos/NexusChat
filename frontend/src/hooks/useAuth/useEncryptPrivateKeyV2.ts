import {
  encryptPrivateKeyV2,
  type RecoveryKeyWrapV2,
} from "@/lib/client/privateKeyEnvelope";
import { useEffect, useRef, useState } from "react";

type PropTypes = {
  privateKeyJWK: JsonWebKey | null;
  recoverySecret: string | null | undefined;
  recoveryKeyWrap: RecoveryKeyWrapV2 | null | undefined;
};

export const useEncryptPrivateKeyV2 = ({
  privateKeyJWK,
  recoverySecret,
  recoveryKeyWrap,
}: PropTypes) => {
  const [encryptedPrivateKey, setEncryptedPrivateKey] = useState<string | null>(
    null
  );
  const [encryptionError, setEncryptionError] = useState<string | null>(null);
  const encryptionStartedRef = useRef(false);

  useEffect(() => {
    if (
      encryptionStartedRef.current ||
      !privateKeyJWK ||
      !recoverySecret ||
      !recoveryKeyWrap
    ) {
      return;
    }

    encryptionStartedRef.current = true;
    void encryptPrivateKeyV2({
      privateKey: privateKeyJWK,
      recoverySecret,
      recoveryKeyWrap,
    })
      .then(setEncryptedPrivateKey)
      .catch(() => {
        setEncryptionError("Private-key setup failed.");
      });
  }, [privateKeyJWK, recoveryKeyWrap, recoverySecret]);

  return { encryptedPrivateKey, encryptionError };
};
