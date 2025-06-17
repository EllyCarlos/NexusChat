import { useEffect } from "react";
import { initializeIndexDb } from "../../lib/client/indexedDB";

export const useInitializeIndexDb = () => {
  useEffect(() => {
    initializeIndexDb();
  }, []);
};
