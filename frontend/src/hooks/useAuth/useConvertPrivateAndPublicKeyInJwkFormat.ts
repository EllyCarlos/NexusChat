import { convertCryptoKeyToJwk } from "@/lib/client/encryption";
import { useEffect, useState } from "react";

type PropTypes = {
  privateKey: CryptoKey | null;
  publicKey: CryptoKey | null;
};

export const useConvertPrivateAndPublicKeyInJwkFormat = ({
  privateKey,
  publicKey,
}: PropTypes) => {
  const [privateKeyJWK, setPrivateKeyJWK] = useState<JsonWebKey | null>(null);
  const [publicKeyJWK, setPublicKeyJWK] = useState<JsonWebKey | null>(null);

  const handleConvertPrivateAndPublicKeyToJwk = async (
    privateKey: CryptoKey,
    publicKey: CryptoKey
  ) => {
    const convertedKeys = await Promise.all([
      convertCryptoKeyToJwk({ cryptoKey: privateKey }),
      convertCryptoKeyToJwk({ cryptoKey: publicKey }),
    ]);
    if (convertedKeys) {
      const [privateKeyJWK, publicKeyJWK] = convertedKeys;
      if (privateKeyJWK) {
        setPrivateKeyJWK(privateKeyJWK);
      }
      if (publicKeyJWK) {
        setPublicKeyJWK(publicKeyJWK);
      }
    }
  };

  useEffect(() => {
    if (privateKey && publicKey) {
      handleConvertPrivateAndPublicKeyToJwk(privateKey, publicKey);
    }
  }, [privateKey, publicKey]);

  return { privateKeyJWK, publicKeyJWK };
};
