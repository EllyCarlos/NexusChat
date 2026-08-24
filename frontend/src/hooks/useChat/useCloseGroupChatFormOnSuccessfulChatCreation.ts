import { useEffect } from "react";
import { setNavMenu, setNewgroupChatForm } from "@/lib/client/slices/uiSlice";
import { useAppDispatch } from "@/lib/client/store/hooks";

type PropTypes = {
  isSuccess: boolean;
};

export const useCloseGroupChatFormOnSuccessfulChatCreation = ({
  isSuccess,
}: PropTypes) => {
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (isSuccess) {
      dispatch(setNavMenu(false));
      dispatch(setNewgroupChatForm(false));
    }
  }, [dispatch, isSuccess]);
};
