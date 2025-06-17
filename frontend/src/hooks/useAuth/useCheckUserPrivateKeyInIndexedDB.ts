import { User } from "@/interfaces/auth.interface";
import { getUserPrivateKeyFromIndexedDB } from "@/lib/client/indexedDB";
import { useCallback, useEffect } from "react";
import { useToggleRecoverPrivateKeyForm } from "../useUI/useToggleRecoverPrivateKeyForm";

type PropTypes = {
  loggedInUser: User;
};

export const useCheckUserPrivateKeyInIndexedDB = ({loggedInUser}: PropTypes) => {

  const { toggleRecoverPrivateKeyForm } = useToggleRecoverPrivateKeyForm();

  const checkPrivateKeyInIndexedDB = useCallback(async () => {
    
    const userPrivateKey = await getUserPrivateKeyFromIndexedDB({userId: loggedInUser.id});
    if (userPrivateKey == null) toggleRecoverPrivateKeyForm();

  }, [loggedInUser.id, toggleRecoverPrivateKeyForm]);

  useEffect(() => {
    checkPrivateKeyInIndexedDB();
  }, []);
};
