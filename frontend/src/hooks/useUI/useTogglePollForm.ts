import { selectPollForm, setPollForm } from "../../lib/client/slices/uiSlice";
import { useAppDispatch, useAppSelector } from "../../lib/client/store/hooks";

export const useTogglePollForm = () => {
  const dispatch = useAppDispatch();
  const pollForm = useAppSelector(selectPollForm);

  const togglePollForm = () => {
    dispatch(setPollForm(!pollForm));
  };

  return {
    togglePollForm,
  };
};
