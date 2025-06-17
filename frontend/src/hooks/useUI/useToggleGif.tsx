import { selectGifForm, setGifForm } from "../../lib/client/slices/uiSlice";
import { useAppDispatch, useAppSelector } from "../../lib/client/store/hooks";

export const useToggleGif = () => {
  
  const isGifOpen = useAppSelector(selectGifForm);
  const dispatch = useAppDispatch();

  const toggleGifForm = () => {
    dispatch(setGifForm(!isGifOpen));
  };

  return {
    toggleGifForm,
  };
};
