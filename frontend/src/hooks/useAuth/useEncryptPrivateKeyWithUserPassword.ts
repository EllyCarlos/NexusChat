import { encryptPrivateKey } from "@/lib/client/encryption";
import { useEffect, useState } from "react";

type PropTypes = {
  password: string | null | undefined;
  privateKeyJWK: JsonWebKey | null;
};

export const useEncryptPrivateKeyWithUserPassword = ({
  password,
  privateKeyJWK,
}: PropTypes) => {
  const [encryptedPrivateKey, setEncryptedPrivateKey] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!password || !privateKeyJWK) {
      return;
    }

    let cancelled = false;
    void encryptPrivateKey(password, privateKeyJWK).then((encryptedKey) => {
      if (!cancelled && encryptedKey) {
        setEncryptedPrivateKey(encryptedKey);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [password, privateKeyJWK]);

  return { encryptedPrivateKey };
};
