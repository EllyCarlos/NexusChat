import { setAddFriendForm, setNavMenu } from "../../lib/client/slices/uiSlice";
import { useAppDispatch } from "../../lib/client/store/hooks";

export const useOpenAddFriendForm = () => {
  const dispatch = useAppDispatch();

  const openAddFriendForm = () => {
    dispatch(setNavMenu(false));
    dispatch(setAddFriendForm(true));
  };
  return { openAddFriendForm };
};
