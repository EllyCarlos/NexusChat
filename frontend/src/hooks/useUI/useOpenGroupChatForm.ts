import { setNavMenu, setNewgroupChatForm } from "@/lib/client/slices/uiSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";

export const useOpenGroupChatForm = () => {
  const dispatch = useAppDispatch();
  const openGroupChatForm = () => {
    dispatch(setNavMenu(false));
    dispatch(setNewgroupChatForm(true));
  };
  return { openGroupChatForm };
};
