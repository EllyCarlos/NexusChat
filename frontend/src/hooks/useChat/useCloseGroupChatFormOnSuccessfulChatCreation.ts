import { useEffect } from "react";
import { useToggleGroupChatForm } from "../useUI/useToggleGroupChatForm";

type PropTypes = {
  isSuccess: boolean;
};

export const useCloseGroupChatFormOnSuccessfulChatCreation = ({
  isSuccess,
}: PropTypes) => {
  const { toggleGroupChatForm } = useToggleGroupChatForm();

  useEffect(() => {
    if (isSuccess) toggleGroupChatForm();
  }, [isSuccess]);
};
