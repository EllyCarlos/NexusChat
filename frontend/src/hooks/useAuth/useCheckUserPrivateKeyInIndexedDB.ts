import { User } from "@/interfaces/auth.interface";
import { getUserPrivateKeyFromIndexedDB } from "@/lib/client/indexedDB";
import { setRecoverPrivateKeyForm } from "@/lib/client/slices/uiSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { useEffect } from "react";

type PropTypes = {
  loggedInUser: User;
};

export const useCheckUserPrivateKeyInIndexedDB = ({loggedInUser}: PropTypes) => {
  const dispatch = useAppDispatch();

  useEffect(() => {
    let cancelled = false;

    getUserPrivateKeyFromIndexedDB({ userId: loggedInUser.id }).then((userPrivateKey) => {
      if (!cancelled && userPrivateKey == null) {
        dispatch(setRecoverPrivateKeyForm(true));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [dispatch, loggedInUser.id]);
};
