import {
  setFriendRequestForm,
  setNavMenu,
} from "../../lib/client/slices/uiSlice";
import { useAppDispatch } from "../../lib/client/store/hooks";

export const useOpenFriendRequestForm = () => {
  const dispatch = useAppDispatch();

  const openFriendRequestForm = () => {
    dispatch(setNavMenu(false));
    dispatch(setFriendRequestForm(true));
  };

  return { openFriendRequestForm };
};
