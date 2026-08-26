import { User } from "@/interfaces/auth.interface";
import { getUserPrivateKeyFromIndexedDB } from "@/lib/client/indexedDB";
import { setRecoverPrivateKeyForm } from "@/lib/client/slices/uiSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";
import { useEffect } from "react";

type PropTypes = {
  loggedInUser: User;
};

type CheckPrivateKeyAvailabilityOptions = {
  userId: string;
  getPrivateKey?: typeof getUserPrivateKeyFromIndexedDB;
  isCancelled: () => boolean;
  onRecoveryRequired: () => void;
};

export const checkPrivateKeyAvailability = async ({
  userId,
  getPrivateKey = getUserPrivateKeyFromIndexedDB,
  isCancelled,
  onRecoveryRequired,
}: CheckPrivateKeyAvailabilityOptions) => {
  try {
    const userPrivateKey = await getPrivateKey({ userId });
    if (!isCancelled() && userPrivateKey == null) {
      onRecoveryRequired();
    }
  } catch {
    if (isCancelled()) {
      return;
    }

    console.error("Unable to verify private-key storage.");
    onRecoveryRequired();
  }
};

export const useCheckUserPrivateKeyInIndexedDB = ({loggedInUser}: PropTypes) => {
  const dispatch = useAppDispatch();

  useEffect(() => {
    let cancelled = false;

    void checkPrivateKeyAvailability({
      userId: loggedInUser.id,
      isCancelled: () => cancelled,
      onRecoveryRequired: () => dispatch(setRecoverPrivateKeyForm(true)),
    });

    return () => {
      cancelled = true;
    };
  }, [dispatch, loggedInUser.id]);
};
