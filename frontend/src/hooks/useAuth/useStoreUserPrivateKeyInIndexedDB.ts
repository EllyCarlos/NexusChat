import { storeUserPrivateKeyInIndexedDB } from "@/lib/client/indexedDB";
import { useEffect } from "react";

type PropTypes = {
  privateKey: JsonWebKey | null;
  userId: string | undefined | null;
};

export const useStoreUserPrivateKeyInIndexedDB = ({
  privateKey,
  userId,
}: PropTypes) => {
  
  useEffect(() => {
    if (privateKey && userId) {
      void storeUserPrivateKeyInIndexedDB({ privateKey, userId }).catch(() => {
        console.error("Unable to store private key in IndexedDB.");
      });
    }
  }, [privateKey, userId]);
};
