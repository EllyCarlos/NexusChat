import {
  selectChatDetailsBar,
  setChatDetailsBar,
} from "../../lib/client/slices/uiSlice";
import { useAppDispatch, useAppSelector } from "../../lib/client/store/hooks";

export const useToggleChatDetailsBar = () => {
  const dispatch = useAppDispatch();
  const chatDetailsBar = useAppSelector(selectChatDetailsBar);

  const toggleChatDetailsBar = () => {
    dispatch(setChatDetailsBar(!chatDetailsBar));
  };
  return { toggleChatDetailsBar };
};
