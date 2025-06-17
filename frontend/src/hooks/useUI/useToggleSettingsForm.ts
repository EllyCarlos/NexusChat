import {
  selectSettingsForm,
  setNavMenu,
  setSettingsForm,
} from "../../lib/client/slices/uiSlice";
import { useAppDispatch, useAppSelector } from "../../lib/client/store/hooks";

export const useToggleSettingsForm = () => {
  const dispatch = useAppDispatch();

  const settingsForm = useAppSelector(selectSettingsForm);

  return () => {
    dispatch(setNavMenu(false));
    dispatch(setSettingsForm(!settingsForm));
  };
};
