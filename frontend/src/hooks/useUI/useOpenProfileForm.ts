import { setNavMenu, setProfileForm } from "../../lib/client/slices/uiSlice";
import { useAppDispatch } from "../../lib/client/store/hooks";

export const useOpenProfileForm = () => {
  const dispatch = useAppDispatch();

  const openProfileForm = () => {
    dispatch(setNavMenu(false));
    dispatch(setProfileForm(true));
  };
  return { openProfileForm };
};
