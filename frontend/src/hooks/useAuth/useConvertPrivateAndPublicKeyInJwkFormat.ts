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

  useEffect(() => {
    if (!privateKey || !publicKey) {
      return;
    }

    let cancelled = false;
    void Promise.all([
      convertCryptoKeyToJwk({ cryptoKey: privateKey }),
      convertCryptoKeyToJwk({ cryptoKey: publicKey }),
    ]).then(([convertedPrivateKey, convertedPublicKey]) => {
      if (cancelled) return;
      if (convertedPrivateKey) setPrivateKeyJWK(convertedPrivateKey);
      if (convertedPublicKey) setPublicKeyJWK(convertedPublicKey);
    });

    return () => {
      cancelled = true;
    };
  }, [privateKey, publicKey]);

  return { privateKeyJWK, publicKeyJWK };
};
