import { selectChatBar, setChatBar } from "../../lib/client/slices/uiSlice";
import { useAppDispatch, useAppSelector } from "../../lib/client/store/hooks";

export const useToggleChatBar = () => {
  const dispatch = useAppDispatch();
  const chatBar = useAppSelector(selectChatBar);

  const toggleChatBar = () => {
    dispatch(setChatBar(!chatBar));
  };

  return { toggleChatBar };
};
