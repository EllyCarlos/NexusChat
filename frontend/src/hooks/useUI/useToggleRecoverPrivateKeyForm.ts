import {
  selectRecoverPrivateKeyForm,
  setRecoverPrivateKeyForm,
} from "@/lib/client/slices/uiSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";

export const useToggleRecoverPrivateKeyForm = () => {
  const dispatch = useAppDispatch();
  const recoverPrivateKeyForm = useAppSelector(selectRecoverPrivateKeyForm);

  const toggleRecoverPrivateKeyForm = () => {
    dispatch(setRecoverPrivateKeyForm(!recoverPrivateKeyForm));
  };

  return { toggleRecoverPrivateKeyForm };
};
