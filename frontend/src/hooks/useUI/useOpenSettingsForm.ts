import { setNavMenu, setSettingsForm } from "@/lib/client/slices/uiSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";

export const useOpenSettingsForm = () => {
  const dispatch = useAppDispatch();
  const openSettingsForm = () => {
    dispatch(setNavMenu(false));
    dispatch(setSettingsForm(true));
  };
  return { openSettingsForm };
};
