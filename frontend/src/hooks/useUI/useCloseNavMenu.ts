import { setNavMenu } from "@/lib/client/slices/uiSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";

export const useCloseNavMenu = () => {
  const dispatch = useAppDispatch();
  const closeNavMenu = () => {
    dispatch(setNavMenu(false));
  };
  return { closeNavMenu };
};
