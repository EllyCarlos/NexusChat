import { selectNavMenu, setNavMenu } from "../../lib/client/slices/uiSlice";
import { useAppDispatch, useAppSelector } from "../../lib/client/store/hooks";

export const useToggleNavMenu = () => {
  const dispatch = useAppDispatch();
  const isNavMenuOpen = useAppSelector(selectNavMenu);

  return () => {
    dispatch(setNavMenu(!isNavMenuOpen));
  };
};
