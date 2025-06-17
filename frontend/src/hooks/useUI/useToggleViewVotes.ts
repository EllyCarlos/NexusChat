import { selectViewVotes, setViewVotes } from "@/lib/client/slices/uiSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";

export const useToggleViewVotes = () => {
  const dispatch = useAppDispatch();
  const viewVotes = useAppSelector(selectViewVotes);

  const toggleViewVotes = () => {
    dispatch(setViewVotes(!viewVotes));
  };
  return { toggleViewVotes };
};
