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

  const handleEncryptPrivateKey = async (
    password: string,
    privateKeyJWK: JsonWebKey
  ) => {
    const encryptedPrivateKey = await encryptPrivateKey(
      password,
      privateKeyJWK
    );
    if (encryptedPrivateKey) {
      setEncryptedPrivateKey(encryptedPrivateKey);
    }
  };

  useEffect(() => {
    if (password && privateKeyJWK) {
      handleEncryptPrivateKey(password, privateKeyJWK);
    }
  }, [password, privateKeyJWK]);

  return { encryptedPrivateKey };
};
