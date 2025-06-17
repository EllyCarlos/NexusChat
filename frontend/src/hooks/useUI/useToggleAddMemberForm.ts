import {
  selectAddMemberForm,
  setAddMemberForm,
} from "@/lib/client/slices/uiSlice";
import { useAppDispatch, useAppSelector } from "@/lib/client/store/hooks";

export const useToggleAddMemberForm = () => {
  const dispatch = useAppDispatch();
  const addMemberForm = useAppSelector(selectAddMemberForm);

  const toggleAddMemberForm = () => {
    dispatch(setAddMemberForm(!addMemberForm));
  };

  return { toggleAddMemberForm };
};
