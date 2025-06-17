import { User } from "@/interfaces/auth.interface";
import { generateKeyPair } from "@/lib/client/encryption";
import { useEffect, useState } from "react";

type PropTypes = {
  user: User | undefined | boolean | null;
};

export const useGenerateKeyPair = ({ user }: PropTypes) => {
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [publicKey, setPublicKey] = useState<CryptoKey | null>(null);

  const generateKeyPairAndConvertItInJwkFormat = async () => {
    const keys = await generateKeyPair();
    if (keys) {
      const { privateKey, publicKey } = keys;
      setPrivateKey(privateKey);
      setPublicKey(publicKey);
    }
  };

  useEffect(() => {
    if (user) {
      generateKeyPairAndConvertItInJwkFormat();
    }
  }, [user]);

  return { privateKey, publicKey };
};
