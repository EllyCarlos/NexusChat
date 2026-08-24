import { User } from "@/interfaces/auth.interface";
import { generateKeyPair } from "@/lib/client/encryption";
import { useEffect, useState } from "react";

type PropTypes = {
  user: User | undefined | boolean | null;
};

export const useGenerateKeyPair = ({ user }: PropTypes) => {
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [publicKey, setPublicKey] = useState<CryptoKey | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;
    void generateKeyPair().then((keys) => {
      if (!cancelled && keys) {
        setPrivateKey(keys.privateKey);
        setPublicKey(keys.publicKey);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  return { privateKey, publicKey };
};
