import type { Theme } from "@/interfaces/theme.interface";
import { setDarkMode } from "@/lib/client/slices/uiSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";

export const useUpdateTheme = () => {
  const dispatch = useAppDispatch();

  const updateTheme = (theme: Theme) => {
    localStorage.setItem("theme", theme);
    document.body.classList.remove("dark", "light");
    document.body.classList.add(theme);
    dispatch(setDarkMode(theme === "dark" ? true : false));
  };
  return { updateTheme };
};
