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
      console.log("storing private key in indexedDB");
      storeUserPrivateKeyInIndexedDB({ privateKey, userId });
    }
  }, [privateKey, userId]);
};
