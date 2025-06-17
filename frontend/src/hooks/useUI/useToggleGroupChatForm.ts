import {
  selectGroupChatForm,
  setNavMenu,
  setNewgroupChatForm,
} from "../../lib/client/slices/uiSlice";
import { useAppDispatch, useAppSelector } from "../../lib/client/store/hooks";

export const useToggleGroupChatForm = () => {
  const dispatch = useAppDispatch();
  const groupChatForm = useAppSelector(selectGroupChatForm);

  const toggleGroupChatForm = () => {
    dispatch(setNavMenu(false));
    dispatch(setNewgroupChatForm(!groupChatForm));
  };

  return { toggleGroupChatForm };
};
